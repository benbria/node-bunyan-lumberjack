[![NPM](https://nodei.co/npm/bunyan-lumberjack.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/bunyan-lumberjack/)

What is it?
===========

bunyan-lumberjack is a stream for [Bunyan](https://github.com/trentm/node-bunyan) which takes in
Bunyan logs and writes the results to Logstash via the lumberjack protocol (used by
[logstash-forwarder](https://github.com/elasticsearch/logstash-forwarder)).

Features
========

* Logs are encrypted on the wire using TLS/SSL.
* Auto-reconnect.
* Logs are queued while disconnected, to minimize the chances any logs are lost during a disconnect.
* Intelligent dropping of messages.
* Generated entries in logstash are identical to what would be produced by
  [bunyan-logstash-tcp](https://github.com/chris-rock/bunyan-logstash-tcp), making it easy to
  switch from one to the other.
* Support for @metadata on app & item level (with _md shorthand)

There are alternatives to this package if you don't need/want encryption:

* [bunyan-logstash-tcp](https://github.com/chris-rock/bunyan-logstash-tcp) - sends logs over TCP transport.
  Logs can be encrypted.  Logs sent while disconnected are dropped.
* [bunyan-logstash](https://github.com/sheknows/bunyan-logstash) - sends logs over UDP transport.
  Logs are not encrypted.  Logs may be lost because UDP is not reliable.

Installation
============

    npm install --save bunyan-lumberjack

Usage
=====

See [below](#tutorial) for a
complete end-to-end setup, but the basics are:

```javascript
var bunyanLumberjackStream = require('bunyan-lumberjack');

var log = bunyan.createLogger({
    name: "myLog",
    streams: [{
        level:  'info',
        type:   'raw',
        stream: bunyanLumberjackStream({
            tlsOptions: {host: 'logstash.mycorp.com', port: 5000},
            lumberjackOptions: {
                allowDrop: function(logEntry) {
                    // If we have to drop logs, drop INFO level logs and lower - keep errors.
                    return logEntry.level <= bunyan.INFO
                }
            },
            metadata:{beat:"example",type:"default"}
        })
    }]
});
```

Options
=======

### tlsOptions

You can pass anything here that you would normally pass to
[`tls.connect()`](http://nodejs.org/api/tls.html#tls_tls_connect_options_callback).  You probably
want to pass `host`, `port`, and if you're using a self-signed certificate, `ca`.  See the
[the tutorial](#tutorial) for a
concrete example.

If you're having problems connecting, have a look at the
[lumberjack-proto troubleshooting section](https://github.com/benbria/node-lumberjack-protocol/blob/master/README.md#troubleshooting).

### lumberjackOptions

Any option that can be passed to [lumberjack-proto](https://github.com/benbria/node-lumberjack-proto)
can be passed here.  If unspecified, this defaults to `{unref: true}`.

Note that `lumberjackOptions.allowDrop` is passed a lumberjack data frame; this will have a
`line` field, which is the JSON string to be sent to logstash, a `host` field, and a `bunyanLevel` field.

### tags

An array of tags to use in the logstash log entry.  Defaults to `['bunyan']`.

### appName

The name to use for the application in the `source` field.  Defaults to `process.title`.

### type

If specified, will be added to the entry before being sent to logstash.  Defaults to 'json'.

### metadata

If specified, will be added to the entry before being sent to logstash.  Can be used for extra parameters that will stay within logstash (logstash will not forward these to elasticsearch).  Defaults to empty object.

Tutorial
========

This explains how to set up logstash and bunyan-lumberjack to work together.  This assumes you have
a [working logstash server up and running](http://www.thedreaming.org/2014/11/21/docker-logstash/).

### Create a Certificate

First, we need a certificate and private key on the logstash server.  You can generate a self-signed
certificate:

    $ sudo mkdir -p /etc/logstash/ssl
    $ sudo openssl req -new -nodes -x509 \
      -subj "/C=CA/ST=Onatrio/L=Ottawa/O=IT/CN=logstash.mycompany.com" \
      -days 3650 -keyout /etc/logstash/ssl/lumberjack.key \
      -out /etc/logstash/ssl/lumberjack.crt -extensions v3_ca
    $ sudo chmod 700 /etc/logstash/ssl/lumberjack.key

Note that the `CN` above *MUST* be the host name you pass to `bunyan-lumberjack` via
`tlsOptions.host` or else `bunyan-lumberjack` will not be able to connect.  You can't use an IP
here.  See the
[lumberjack-proto troubleshooting section](https://github.com/benbria/node-lumberjack-proto/blob/master/README.md#troubleshooting)
for more details and workarounds.

If your logstash server is not running as root, make sure it has read access to lumberjack.key
(but this is a secret key, so try to limit who has access to it.)

Also note that while a self-signed certificate is usually not trustworthy, here it will be because
we're going to copy the self-signed certificate to the client - the client won't connect to just
any self-signed certificate.

### Configure Logstash

The simple way to do this is to add this to the `input` section of logstash.conf:

    lumberjack {
        codec => json
        port => 5000
        ssl_certificate => "/etc/logstash/ssl/logstash.crt"
        ssl_key => "/etc/logstash/ssl/logstash.key"
    }

Here the `codec` must be set to `json` to work correctly with `bunyan-lumberjack`.

Alternatively, by default bunyan-lumberjack will set the `type` to 'json', so if you want to be
able to share a single lumberjack input for multiple different types of logs:

    input {
        lumberjack {
            port => 5000
            ssl_certificate => "/opt/ssl/logstash.crt"
            ssl_key => "/opt/ssl/logstash.key"
        }
    }

    filter {
        if [type] == "json" {
            json {
                source => "message"
            }
        }

        if [type] == "syslog" {
            grok {
                match => { "message" => "%{SYSLOGLINE}" }
            }
        }

        # Other filters go here...
    }


### The Client

On the client side, we need a copy of the `logstash.crt` file we just created, then:

```javascript
var fs = require('fs');
var bunyan = require('bunyan');
var bunyanLumberjackStream = require('bunyan-lumberjack');

outStream = bunyanLumberjackStream({
    tlsOptions: {
        host: 'logstash.mycorp.com',
        port: 5000,
        ca: [fs.readFileSync('path/to/logstash.crt', {encoding: 'utf-8'})]
    },
    metadata:{beat:"lowercase-name",type:"default"}
});

outStream.on('connect', function() {
    console.log("Connected!");
});
outStream.on('dropped', function(count) {
    console.log("ERROR: Dropped " + count + " messages!");
});
outStream.on('disconnect', function(err) {
    console.log("WARN : Disconnected", err);
});

var log = bunyan.createLogger({
    name: "myLog",
    streams: [{level: 'info', type: 'raw', stream: outStream}]
});

log.info("This should work!");

log.info({_md:{type:"custom"}},"Item-based custom metadata!");
