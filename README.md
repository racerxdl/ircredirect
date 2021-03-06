IRC Redirect
============

IRC to MQTT Message Redirection

This is a very simple message broker that will send any messages it receives to a MQTT Topic. To use simple define those environment variables:

* `irc_server` => "irc.freenode.com" - The IRC Server to connect
* `irc_nickname` => "redbot-XX" - This bot nickname (__defaults to redbot-XX__)
* `irc_channel` => "#ircredirect" - The IRC Channel to Listen Messages
* `mqtt_server` => "mosquitto.mosquitto" - The MQTT Server Hostname
* `mqtt_topic` => "ircredirect" - The MQTT Topic to send messages

Then this bot will automatically send a JSON message to MQTT Topic in the following format:

```json
{
  "type": "message",
  "from": "nickname",
  "to": "nickname or channel",
  "message": "message sent",
}
```

A docker image is available at `racerxdl/ircredirect`:

```bash
docker run \
  -e irc_server="irc.freenode.net" \
  -e irc_nickname="mybot" \
  -e irc_channel="#ircredirect" \
  -e mqtt_server="mosquitto"
  -e mqtt_topic="ircredirect" \
  racerxdl/ircredirect
```


MQTT to IRC Messages
====================

Aditionally, this redirect works in the other way, redirecting messages from MQTT to IRC. It does that by listen on a `YOURTOPIC_msg` MQTT Topic. For example of `mqtt_topic` is __mymessages__, it will listen for inputs in __mymessages_msg__. You can send a JSON String payload with the following content:

```json
{
  "sendmsg": true,
  "to": "nickname or channel",
  "message": "message to send"
}
```
