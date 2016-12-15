var BunyanLumberjackStream, LEVELS, Writable, bunyan, clone, lumberjack, merge_options,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Writable = require('stream').Writable;

lumberjack = require('lumberjack-protocol');

bunyan = require('bunyan');

LEVELS = (function() {
  var answer;
  answer = {};
  ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].forEach(function(level) {
    return answer[bunyan[level.toUpperCase()]] = level;
  });
  return answer;
})();

clone = function(obj) {
  var answer, key, value;
  answer = {};
  for (key in obj) {
    value = obj[key];
    answer[key] = value;
  }
  return answer;
};


/*
Overwrites obj1's values with obj2's and adds obj2's if non existent in obj1
@param obj1
@param obj2
@returns obj3 a new object based on obj1 and obj2
 */

merge_options = function(obj1, obj2) {
  var attrname, obj3;
  obj3 = {};
  for (attrname in obj1) {
    obj3[attrname] = obj1[attrname];
  }
  for (attrname in obj2) {
    obj3[attrname] = obj2[attrname];
  }
  return obj3;
};

BunyanLumberjackStream = (function(superClass) {
  extend(BunyanLumberjackStream, superClass);

  function BunyanLumberjackStream(tlsOptions, lumberjackOptions, options) {
    var ref, ref1, ref2, ref3;
    if (lumberjackOptions == null) {
      lumberjackOptions = {};
    }
    if (options == null) {
      options = {};
    }
    BunyanLumberjackStream.__super__.constructor.call(this, {
      objectMode: true
    });
    this._client = lumberjack.client(tlsOptions, lumberjackOptions);
    this._client.on('connect', (function(_this) {
      return function(count) {
        return _this.emit('connect', count);
      };
    })(this));
    this._client.on('dropped', (function(_this) {
      return function(count) {
        return _this.emit('dropped', count);
      };
    })(this));
    this._client.on('disconnect', (function(_this) {
      return function(err) {
        return _this.emit('disconnect', err);
      };
    })(this));
    this._host = require('os').hostname();
    this._tags = (ref = options.tags) != null ? ref : ['bunyan'];
    this._type = (ref1 = options.type) != null ? ref1 : 'json';
    this._application = (ref2 = options.appName) != null ? ref2 : process.title;
    this._metadata = (ref3 = options.metadata) != null ? ref3 : {};
    this.on('finish', (function(_this) {
      return function() {
        return _this._client.close();
      };
    })(this));
  }

  BunyanLumberjackStream.prototype._write = function(entry, encoding, done) {
    var bunyanLevel, dataFrame, host, ref, ref1;
    entry = clone(entry);
    host = (ref = entry.hostname) != null ? ref : this._host;
    bunyanLevel = entry.level;
    if (LEVELS[entry.level] != null) {
      entry.level = LEVELS[entry.level];
    }
    entry.message = (ref1 = entry.msg) != null ? ref1 : '';
    delete entry.msg;
    if (entry.time != null) {
      entry['@timestamp'] = entry.time.toISOString();
      delete entry.time;
    }
    delete entry.v;
    if (entry.tags == null) {
      entry.tags = this._tags;
    }
    if (entry._md) {
      entry["@metadata"] = entry._md;
      delete entry._md;
    }
    if (entry["@metadata"] == null) {
      entry["@metadata"] = this._metadata;
    } else {
      entry["@metadata"] = merge_options(this._metadata, entry["@metadata"]);
    }
    entry.source = host + "/" + this._application;
    dataFrame = {
      line: JSON.stringify(entry, bunyan.safeCycles()),
      host: host,
      bunyanLevel: bunyanLevel
    };
    if (this._type != null) {
      dataFrame.type = this._type;
    }
    this._client.writeDataFrame(dataFrame);
    return done();
  };

  return BunyanLumberjackStream;

})(Writable);

module.exports = function(options) {
  if (options == null) {
    options = {};
  }
  if (options.lumberjackOptions == null) {
    options.lumberjackOptions = {};
  }
  if (options.lumberjackOptions.unref == null) {
    options.lumberjackOptions.unref = true;
  }
  return new BunyanLumberjackStream(options.tlsOptions, options.lumberjackOptions, options);
};
