
{Writable} = require 'stream'
lumberjack = require 'lumberjack-protocol'
bunyan     = require 'bunyan'

LEVELS = do ->
    answer = {}

    ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].forEach (level) ->
        answer[bunyan[level.toUpperCase()]] = level

    return answer

# Shallow clone
clone = (obj) ->
    answer = {}
    answer[key] = value for key, value of obj
    return answer

###
Overwrites obj1's values with obj2's and adds obj2's if non existent in obj1
@param obj1
@param obj2
@returns obj3 a new object based on obj1 and obj2
###
merge_options = (obj1, obj2) ->
  obj3 = {}
  for attrname of obj1
    obj3[attrname] = obj1[attrname]
  for attrname of obj2
    obj3[attrname] = obj2[attrname]
  obj3

class BunyanLumberjackStream extends Writable
    constructor: (tlsOptions, lumberjackOptions={}, options={}) ->
        super {objectMode: true}

        @_client = lumberjack.client tlsOptions, lumberjackOptions

        @_client.on 'connect', (count) => @emit 'connect', count
        @_client.on 'dropped', (count) => @emit 'dropped', count
        @_client.on 'disconnect', (err) => @emit 'disconnect', err

        @_host = require('os').hostname()
        @_tags = options.tags ? ['bunyan']
        @_type = options.type ? 'json'
        @_application = options.appName ? process.title
        @_metadata = options.metadata ? {}

        @on 'finish', =>
            @_client.close()

    _write: (entry, encoding, done) ->
        # Clone the entry so we can modify it
        entry = clone(entry)

        host = entry.hostname ? @_host

        # Massage the entry to look like a logstash entry.
        bunyanLevel = entry.level
        if LEVELS[entry.level]?
            entry.level = LEVELS[entry.level]

        entry.message = entry.msg ? ''
        delete entry.msg

        if entry.time?
            entry['@timestamp'] = entry.time.toISOString()
            delete entry.time

        delete entry.v

        # Add some extra fields
        entry.tags ?= @_tags
        unless entry["@metadata"]?
          entry["@metadata"] = @_metadata
        else
          entry["@metadata"] = merge_options(@_metadata, entry["@metadata"])
        entry.source = "#{host}/#{@_application}"

        dataFrame = {
            line: JSON.stringify(entry)
            host: host
            bunyanLevel: bunyanLevel
        }

        # Set type directly on the data frame, so we can use it for conditionals up in
        # logstash filters section.
        if @_type? then dataFrame.type = @_type

        @_client.writeDataFrame dataFrame

        done()

module.exports = (options={}) ->
    if !options.lumberjackOptions?
        options.lumberjackOptions = {}
    if !options.lumberjackOptions.unref?
        options.lumberjackOptions.unref = true

    return new BunyanLumberjackStream(
        options.tlsOptions,
        options.lumberjackOptions,
        options
    )
