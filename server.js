#!/usr/bin/env nodejs

// IRC to MQTT Message Redirection
// Copyright (C) 2016  Lucas Teske

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

const mqtt = require('mqtt');
const irc = require('irc');
const { QLog, undefinedOrNull } = require('quanto-commons');

const ircServer = process.env['irc_server'];
const ircChannel = process.env['irc_channel'];
const ircNickname = process.env['irc_nickname'] || `redbot-${Math.round(Math.random() * 100)}`;

const mqttHost = process.env['mqtt_server'];
const mqttServer = `mqtt://${mqttHost}`;
const mqttTopic = process.env['mqtt_topic'];

const GlobalLog = QLog.scope('Global');
const IrcLog = QLog.scope('IRC');
const MQTTLog = QLog.scope('MQTT');

GlobalLog.headPadding = 30;
IrcLog.headPadding = 30;
MQTTLog.headPadding = 30;

IrcLog.enableLogs(['debug']);

// region Check Variables
if (undefinedOrNull(ircServer)) {
  GlobalLog.error(`IRC Server was not defined! Please define at environment variable ${'irc_server'.warn.bold}`);
}
if (undefinedOrNull(ircChannel)) {
  GlobalLog.error(`IRC Channel was not defined! Please define at environment variable ${'irc_channel'.warn.bold}`);
}
if (undefinedOrNull(mqttHost)) {
  GlobalLog.error(`MQTT Server was not defined! Please define at environment variable ${'mqtt_server'.warn.bold}`);
}
if (undefinedOrNull(mqttTopic)) {
  GlobalLog.error(`MQTT Topic was not defined! Please define at environment variable ${'mqtt_topic'.warn.bold}`);
}

if (undefinedOrNull(ircServer) || undefinedOrNull(ircChannel) || undefinedOrNull(mqttHost) || undefinedOrNull(mqttTopic)) {
  GlobalLog.fatal('One or more environment variables not defined. Aborting...');
  process.exit(1);
}
// endregion

GlobalLog.info(`IRC Server: ${ircServer.bold}`);
GlobalLog.info(`IRC Channel: ${ircChannel.bold}`);
GlobalLog.info(`IRC Nickname: ${ircNickname.bold}`);
GlobalLog.info(`MQTT Server URL: ${mqttServer.bold}`);
GlobalLog.info(`MQTT Topic: ${mqttTopic.bold}`);


let mqttClient;

// region IRC
const ircc = new irc.Client(ircServer, ircNickname, {
  channels: [
    ircChannel
  ],
  retryDelay: 60000,
  autoRejoin: true
});
ircc.addListener('message', (from, to, message) => {
  IrcLog.info(`(${to.white}) ${from.warn.bold}: ${message || 'No Message'}`);
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

ircc.addListener('motd', (message) => {
  IrcLog.pending(message);
});

ircc.addListener('notice', (nick, to, text, message) => {
  IrcLog.debug(`NOTICE: ${nick || 'Server'} => ${to}: ${text}`.debug);
});

ircc.addListener('nick', (oldnick, newnick, channels, message) => {
  const msg = `User ${oldnick.warn.bold} has changed its name to ${newnick.warn.bold}`;
  IrcLog.success(msg);
  mqttClient.publish(mqttTopic, JSON.stringify({
    type: "message",
    from: "SERVER",
    to: ircChannel,
    message: msg,
  }));
});

ircc.addListener('quit', (channel, nick, reason, message) => {
  const msg = `User ${nick.warn.bold} has exited ${ircChannel.warn.bold}: ${reason || 'Goodbye'}`;
  IrcLog.pause(msg);
  mqttClient.publish(mqttTopic, JSON.stringify({
    type: "message",
    from: "SERVER",
    to: ircChannel,
    message: msg,
  }));
});

ircc.addListener('part', (channel, nick, reason, message) => {
  const msg = `User ${nick.warn.bold} has exited ${channel.warn.bold}: ${reason || 'Goodbye'}`;
  IrcLog.pause(msg);
  mqttClient.publish(mqttTopic, JSON.stringify({
    type: "message",
    from: "SERVER",
    to: ircChannel,
    message: msg,
  }));
});
ircc.addListener('join', (channel, nick, message) => {
  const msg = `User ${nick.warn.bold} has join ${channel.warn.bold}`;
  IrcLog.pause(msg);
  mqttClient.publish(mqttTopic, JSON.stringify({
    type: "message",
    from: "SERVER",
    to: ircChannel,
    message: msg,
  }));
});

ircc.addListener('registered', function(message) {
  IrcLog.start("Registered");
  if (mqttClient !== undefined) {
    mqttClient.publish(mqttTopic, JSON.stringify({
        "type": "botregistered",
        "message": message
      })
    );
  }
});

ircc.addListener('pm', function (from, message) {
  IrcLog.fav(`PM ${from} => ME: ${message}`);
});

ircc.addListener('error', (message) => {
  IrcLog.error(message);
  if (mqttClient !== undefined) {
    mqttClient.publish(mqttTopic, JSON.stringify({
        "type": "boterror",
        "message": message
      })
    );
  }
});
// endregion

// region MQTT
mqttClient  = mqtt.connect(mqttServer)

mqttClient.on('connect', () => {
  MQTTLog.start('Connected');
  mqttClient.subscribe(mqttTopic + "_msg");
  mqttClient.publish(mqttTopic, JSON.stringify({
    "type": "bot_enter"
  }));
});

mqttClient.on('message', (topic, message) => {
  // message is Buffer
  try {
    if (topic === mqttTopic + "_msg") {
      const data = JSON.parse(message.toString());
      if (data.hasOwnProperty("sendmsg") && data.hasOwnProperty("message")) {
        const to = data.hasOwnProperty("to") ? data["to"] : ircChannel;
        MQTTLog.info(`${to.warn.bold}: ${data["message"]}`);
        ircc.say(to, data["message"]);
      }
    }
  } catch(e) {
    MQTTLog.error(`Invalid message: ${message.toString()}`);
  }
});
// endregion