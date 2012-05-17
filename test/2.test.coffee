{exec} = require 'child_process'
fs = require 'fs'
require 'should'
task = 'TEST0'
fairy = require("#{__dirname}/..").connect()
queue = fairy.queue task
total = 2000
groups = 10
generated = 0
group_sequence = [0 .. groups - 1].map -> 0
child_processes = []

module.exports = 

  'abc' :

    'should clear the queue first': (done) ->
      queue.clear (err, statistics) ->
        statistics.total.groups.should.equal 0
        statistics.total.tasks.should.equal 0
        done()

    'should successfully enqueued': (done) ->
      do generate = ->
        if generated++ is total
          queue.statistics (err, statistics) ->
            statistics.total.groups.should.equal groups
            statistics.total.tasks.should.equal total
            done()
        else
          group = parseInt Math.random() * groups
          sequence = group_sequence[group]++
          queue.enqueue group, sequence, generate

    'should all be processed': (done) ->

      exiting = off

      exec "rm -f #{__dirname}/workers/*.dmp", (err, stdout, stderr) ->
        total_process = 8
        child_processes = []
        while --total_process >= 0
          do (total_process) ->
            child_processes[total_process] = exec "coffee #{__dirname}/workers/fail-and-block.coffee" # , (err, stdout, stderr) -> console.log err, stdout, stderr
            child_processes[total_process].on 'exit', ->
              return if exiting
              child_processes[total_process] = exec "coffee #{__dirname}/workers/fail-and-block.coffee"

        do probe = ->
          queue.reschedule (err, statistics) ->
          setTimeout probe, 100

        do killone = ->
          victim_index = Math.round (Math.random() * (child_processes.length - 1))
          child_processes[victim_index].kill 'SIGHUP'
          #child_processes[victim_index].on 'exit', ->
          #  child_processes[victim_index] = exec "coffee #{__dirname}/workers/fail-and-block.coffee"
          #  setTimeout killone, 200

        do stats = ->
          queue.statistics (err, statistics) ->
            if statistics.finished_tasks is total
              setTimeout ->
                queue.statistics (err, statistics) ->
                  if statistics.finished_tasks is total and statistics.pending_tasks is 0
                    exiting = on
                    child_processes.forEach (process) -> process.kill 'SIGHUP'
                    done()
              , 100
            else
              setTimeout stats, 10
            #  queue.statistics (err, statistics) ->
            #    if statistics.pending_tasks is 0 and statistics.processing_tasks is 0 and statistics.finished_tasks isnt total
            #      console.log 'R'
            #      queue.reschedule (err, statistics) ->
            #        console.log statistics.pending_tasks
            #        setTimeout probe, 10
            #    if statistics.finished_tasks is total
            #      statistics.pending_tasks.should.equal 0
            #      statistics.processing_tasks.should.equal 0
            #      done()
            #    else
            #      setTimeout probe, 10

    'should cleanup elegantly on interruption': (done) ->
      child_processes.forEach (process) -> process.kill 'SIGINT'
      setTimeout ->
        queue.statistics (err, statistics) ->
          statistics.workers.should.equal 0
          done()
      , 100

    'should produce sequential results': (done) ->
      [0..groups-1].forEach (group) ->
        dump_file = fs.readFileSync("#{__dirname}/workers/#{group}.dmp").toString()
        dump_file.split('\n')[0..-2].forEach (content, line) ->
          content.should.equal line + ''
      exec "rm -f #{__dirname}/workers/*.dmp", -> done()
