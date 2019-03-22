package main

import (
	"encoding/json"
	"fmt"
	"github.com/eclipse/paho.mqtt.golang"
	"github.com/logrusorgru/aurora"
	"github.com/quan-to/slog"
	"github.com/racerxdl/gohc"
	"gopkg.in/irc.v3"
	"math/rand"
	"net"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

var ircServer = os.Getenv("irc_server")
var ircChannel = os.Getenv("irc_channel")
var ircNickname = os.Getenv("irc_nickname")
var ircPassword = os.Getenv("irc_password")

var mqttHost = os.Getenv("mqtt_server")
var mqttTopic = os.Getenv("mqtt_topic")
var mqttUser = os.Getenv("mqtt_user")
var mqttPass = os.Getenv("mqtt_pass")

var ircLog = slog.Scope("IRC")
var mqttLog = slog.Scope("MQTT")

var mqttClient mqtt.Client
var ircClient *irc.Client
var loggedIn bool

func WriteIRC(line string) {
	ircLog.Debug(line)
	_ = ircClient.Write(line)
}

func Login() {
	if ircPassword != "" {
		// First Identify
		WriteIRC(fmt.Sprintf("NICKSERV IDENTIFY %s %s", ircNickname, ircPassword))
	} else {
		loggedIn = true
	}
}

func JoinChannel(channel string) {
	if !loggedIn && ircPassword != "" {
		Login()
		return
	}
	WriteIRC(fmt.Sprintf("JOIN %s", channel))
}

func OnMessage(channel, from, message string) {
	if from[0] == '~' {
		from = from[1:]
	}

	ircLog.LogNoFormat("(%s) %s: %s", aurora.Bold(channel), aurora.Gray(from), aurora.Cyan(message))

	if mqttClient != nil {
		data := map[string]interface{}{
			"type":    "message",
			"from":    from,
			"to":      channel,
			"message": message,
		}

		jsonData, _ := json.Marshal(data)

		mqttClient.Publish(mqttTopic, 0, false, jsonData)
	}
}

func HealthCheck() bool {
	if mqttClient == nil || ircClient == nil {
		return false
	}

	if !mqttClient.IsConnected() {
		return false
	}

	return true
}

func main() {
	var err error

	if ircNickname == "" {
		n := rand.Int31n(100)
		ircNickname = fmt.Sprintf("redbot-%d", n)
	}

	// region Check Variables
	if ircServer == "" {
		slog.Error(`IRC Server was not defined! Please define at environment variable 'irc_server'}`)
	}
	if ircChannel == "" {
		slog.Error(`IRC Channel was not defined! Please define at environment variable 'irc_channel'`)
	}
	if mqttHost == "" {
		slog.Error(`MQTT Server was not defined! Please define at environment variable 'mqtt_server'`)
	}
	if mqttTopic == "" {
		slog.Error(`MQTT Topic was not defined! Please define at environment variable 'mqtt_topic'`)
	}

	if ircServer == "" || ircChannel == "" || mqttHost == "" || mqttTopic == "" {
		slog.Fatal("One or more environment variables not defined. Aborting...")
	}
	// endregion

	slog.Info(`IRC Server: %s`, ircServer)
	slog.Info(`IRC Channel: %s`, ircChannel)
	slog.Info(`IRC Nickname: %s`, ircNickname)
	slog.Info(`MQTT Server URL: %s`, mqttHost)
	slog.Info(`MQTT Topic: %s`, mqttTopic)

	// region MQTT
	opts := mqtt.NewClientOptions()
	opts.AddBroker(fmt.Sprintf("tcp://%s:1883", mqttHost))
	opts.SetDefaultPublishHandler(func(client mqtt.Client, message mqtt.Message) {
		//mqttLog.Debug(`Received Message on Topic %s: %s`, message.Topic(), string(message.Payload()))
		//doMessage(message.Topic(), message.Payload())
	})
	opts.SetPingTimeout(1 * time.Second)
	opts.SetKeepAlive(2 * time.Second)

	if mqttUser != "" {
		opts.Username = mqttUser
		opts.Password = mqttPass
	}

	mqttClient = mqtt.NewClient(opts)
	if token := mqttClient.Connect(); token.Wait() && token.Error() != nil {
		mqttLog.Fatal(token.Error())
	}

	mqttLog.Info("Connected")

	token := mqttClient.Subscribe(fmt.Sprintf("%s_msg", mqttTopic), 0, nil)
	token.Wait()
	err = token.Error()
	if err != nil {
		mqttLog.Fatal("Error subscribing to %s_msg: %s", "%s", mqttTopic, err)
	}
	// endregion

	// region IRC
	conn, err := net.Dial("tcp", ircServer)
	if err != nil {
		ircLog.Fatal(err)
	}

	loggedIn = false

	config := irc.ClientConfig{
		Nick: ircNickname,
		User: ircNickname,
		Name: ircNickname,
		Handler: irc.HandlerFunc(func(c *irc.Client, m *irc.Message) {
			switch m.Command {
			case "001": // Welcome
				JoinChannel(ircChannel)
			case "002":
			case "003":
			case "004":
			case "005":
			case "250":
			case "251": // User Report
				ircLog.Info(m.Params[1])
			case "252":
			case "253":
			case "254":
			case "255":
			case "265":
			case "266":
			case "353": // Name List
			case "366": // End of Name List
			case "375": // MOTD Start
				ircLog.LogNoFormat("MOTD: %s", aurora.Magenta(m.Params[1]))
			case "372": // MOTD Body
				ircLog.LogNoFormat("MOTD: %s", aurora.Magenta(m.Params[1]))
			case "376": // MOTD End
			case "PRIVMSG":
				if c.FromChannel(m) && len(m.Params) >= 2 {
					channel := m.Params[0]
					message := m.Params[1]
					from := m.User
					OnMessage(channel, from, message)
				}
			case "NOTICE":
				ircLog.LogNoFormat("NOTICE: %s", aurora.Magenta(m.Params[1]))
				if strings.Contains(m.Params[1], "You are now identified") {
					loggedIn = true
					JoinChannel(ircChannel)
				}
			case "JOIN":
				ircLog.LogNoFormat(aurora.Red("JOIN: %s joins %s"), m.User, m.Params[0])
			case "PING":
			default:
				ircLog.Debug("[%s] %s {{%+v}}", m.Command, m.String(), m.Params)
			}
			//else if m.Command == "PRIVMSG" && c.FromChannel(m) {
			//    // Create a handler on all messages.
			//    c.WriteMessage(&irc.Message{
			//        Command: "PRIVMSG",
			//        Params: []string{
			//            m.Params[0],
			//            m.Trailing(),
			//        },
			//    })
			//}
		}),
	}

	c := make(chan os.Signal, 1)
	done := make(chan bool, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGINT, syscall.SIGTERM, syscall.SIGABRT)

	hc := gohc.MakeHealtCheck(HealthCheck)

	go func() {
		err := hc.Listen(":8000")
		if err != nil {
			slog.Error("Error starting healthcheck: %s", err)
		}
	}()

	go func() {
		sig := <-c
		slog.Warn("Received Signal %d", sig)
		if ircClient != nil {
			_ = ircClient.Write("QUIT Farewell my friends")
			time.Sleep(5 * time.Second)
			_ = conn.Close()
		}
		done <- true
	}()

	// Create the client
	ircClient = irc.NewClient(conn, config)
	err = ircClient.Run()
	if err != nil {
		ircLog.Fatal(err)
	}
	// endregion
}
