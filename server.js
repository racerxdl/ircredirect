#!/usr/bin/env nodejs

var mqtt = require('mqtt');
var irc = require('irc');


var ircServer = "irc.freenode.net";
var ircChannel = "#hh";
var ircNickname = "racerxdl_bot";

var mqttServer = "mqtt://teske-db.local";
var mqttTopic = "ircredirect";

var ircc;
var mqttClient;

// IRC Part
ircc = new irc.Client(ircServer, ircNickname, { channels: [ircChannel] });

ircc.addListener('message', function (from, to, message) {
  console.log(from + ' => ' + to + ': ' + message);
  if (mqttClient !== undefined) {
    mqttClient.publish(mqttTopic, JSON.stringify({
        "type": "message",
        "from": from,
        "to": to,
        "message": message
      })
    );
  }
});

ircc.addListener('registered', function(message) {
  console.log("Registered");
  if (mqttClient !== undefined) {
    mqttClient.publish(mqttTopic, JSON.stringify({
        "type": "botregistered",
        "message": message
      })
    );
  }
});

//ircc.addListener('pm', function (from, message) {
//  console.log(from + ' => ME: ' + message);
//});

ircc.addListener('error', function(message) {
  console.log('error: ', message);
  if (mqttClient !== undefined) {
    mqttClient.publish(mqttTopic, JSON.stringify({
        "type": "boterror",
        "message": message
      })
    );
  }
});

// MQTT Part

mqttClient  = mqtt.connect(mqttServer)

mqttClient.on('connect', function () {
  mqttClient.publish(mqttTopic, JSON.stringify({
    "type": "bot_enter"
  }));
})

mqttClient.on('message', function (topic, message) {
  // message is Buffer
  try {
    var data = JSON.parse(message.toString());
    if (data.hasOwnProperty("sendmsg") && data.hasOwnProperty("message")) {
      var to = data.hasOwnProperty("to") ? data["to"] : ircChannel;
      ircc.say(to, data["message"]);
    }
  } catch(e) {
    console.log("Invalid message: " + message.toString());
  }
})