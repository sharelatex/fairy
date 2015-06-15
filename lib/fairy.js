// Generated by CoffeeScript 1.7.1
(function() {
  var Fairy, Queue, cleanup_required, create_client, enter_cleanup_mode, exiting, fairy_id, log_registered_workers, os, prefix, redis, registered_workers, server_ip, uuid,
    __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    __slice = [].slice;

  uuid = require('node-uuid');

  redis = require('redis');

  os = require('os');

  prefix = 'FAIRY';

  exports.connect = function(options) {
    if (options == null) {
      options = {};
    }
    return new Fairy(options);
  };

  exiting = false;

  registered_workers = [];

  log_registered_workers = function() {
    var registered_worker, worker_info, _i, _len, _results;
    console.log("\nFairy is waiting for " + registered_workers.length + " workers to clean-up before exit:");
    _results = [];
    for (_i = 0, _len = registered_workers.length; _i < _len; _i++) {
      registered_worker = registered_workers[_i];
      worker_info = registered_worker.split('|');
      _results.push(console.log("  * Client Id: [" + worker_info[0] + "], Task: [" + worker_info[1] + "]"));
    }
    return _results;
  };

  cleanup_required = false;

  enter_cleanup_mode = function() {
    if (registered_workers.length) {
      log_registered_workers();
      cleanup_required = true;
      return exiting = true;
    } else {
      return process.exit();
    }
  };

  process.on('SIGINT', enter_cleanup_mode);

  process.on('SIGHUP', enter_cleanup_mode);

  process.on('SIGQUIT', enter_cleanup_mode);

  process.on('SIGUSR1', enter_cleanup_mode);

  process.on('SIGUSR2', enter_cleanup_mode);

  process.on('SIGTERM', enter_cleanup_mode);

  process.on('SIGABRT', enter_cleanup_mode);

  process.on('uncaughtException', function(err) {
    console.log('Exception:', err.stack);
    if (registered_workers.length) {
      console.log('Fairy workers will block their processing groups before exit.');
    }
    return enter_cleanup_mode();
  });

  process.on('exit', function() {
    if (cleanup_required) {
      return console.log("Fairy cleaned up, exiting...");
    }
  });

  server_ip = function() {
    var address, addresses, card, _i, _len, _ref;
    _ref = os.networkInterfaces();
    for (card in _ref) {
      addresses = _ref[card];
      for (_i = 0, _len = addresses.length; _i < _len; _i++) {
        address = addresses[_i];
        if (!address.internal && address.family === 'IPv4') {
          return address.address;
        }
      }
    }
    return 'UNKNOWN_IP';
  };

  create_client = function(options) {
    var client;
    client = redis.createClient(options.port, options.host, options.options);
    if (options.password != null) {
      client.auth(options.password);
    }
    return client;
  };

  fairy_id = 0;

  Fairy = (function() {
    function Fairy(options) {
      this.options = options;
      this.statistics = __bind(this.statistics, this);
      this.queues = __bind(this.queues, this);
      this.redis = create_client(options);
      this.id = fairy_id++;
      this.queue_pool = {};
    }

    Fairy.prototype.key = function(key) {
      return "" + prefix + ":" + key;
    };

    Fairy.prototype.queue = function(name) {
      if (this.queue_pool[name]) {
        return this.queue_pool[name];
      }
      this.redis.sadd(this.key('QUEUES'), name);
      return this.queue_pool[name] = new Queue(this, name);
    };

    Fairy.prototype.queues = function(callback) {
      return this.redis.smembers(this.key('QUEUES'), (function(_this) {
        return function(err, res) {
          if (err) {
            return callback(err);
          }
          return callback(null, res.map(function(name) {
            return _this.queue(name);
          }));
        };
      })(this));
    };

    Fairy.prototype.statistics = function(callback) {
      return this.queues(function(err, queues) {
        var i, queue, result, total_queues, _i, _len, _results;
        if (err) {
          return callback(err);
        }
        if (!(total_queues = queues.length)) {
          return callback(null, []);
        }
        result = [];
        _results = [];
        for (i = _i = 0, _len = queues.length; _i < _len; i = ++_i) {
          queue = queues[i];
          _results.push((function(queue, i) {
            return queue.statistics(function(err, statistics) {
              if (err) {
                return callback(err);
              }
              result[i] = statistics;
              if (!--total_queues) {
                if (callback) {
                  return callback(null, result);
                }
              }
            });
          })(queue, i));
        }
        return _results;
      });
    };

    return Fairy;

  })();

  Queue = (function() {
    function Queue(fairy, name) {
      this.fairy = fairy;
      this.name = name;
      this.clear = __bind(this.clear, this);
      this.workers = __bind(this.workers, this);
      this.failed_tasks = __bind(this.failed_tasks, this);
      this.recently_finished_tasks = __bind(this.recently_finished_tasks, this);
      this.reschedule = __bind(this.reschedule, this);
      this._requeue_group = __bind(this._requeue_group, this);
      this._continue_group = __bind(this._continue_group, this);
      this._process = __bind(this._process, this);
      this._try_exit = __bind(this._try_exit, this);
      this._poll = __bind(this._poll, this);
      this.regist = __bind(this.regist, this);
      this.enqueue = __bind(this.enqueue, this);
      this.redis = fairy.redis;
    }

    Queue.prototype.key = function(key) {
      return "" + prefix + ":" + key + ":" + this.name;
    };

    Queue.prototype.polling_interval = 5;

    Queue.prototype.retry_limit = 2;

    Queue.prototype.retry_delay = 0.1 * 1000;

    Queue.prototype.recent_size = 10;

    Queue.prototype.slowest_size = 10;

    Queue.prototype.enqueue = function() {
      var args, callback, _i;
      args = 2 <= arguments.length ? __slice.call(arguments, 0, _i = arguments.length - 1) : (_i = 0, []), callback = arguments[_i++];
      if (typeof callback !== 'function') {
        args.push(callback);
        callback = void 0;
      }
      return this.redis.multi().rpush(this.key('SOURCE'), JSON.stringify([uuid.v4()].concat(__slice.call(args), [Date.now()]))).sadd(this.key('GROUPS'), args[0]).hincrby(this.key('STATISTICS'), 'TOTAL', 1).exec(callback);
    };

    Queue.prototype.regist = function(handler) {
      var worker_id;
      this.handler = handler;
      registered_workers.push("" + this.fairy.id + "|" + this.name);
      worker_id = uuid.v4();
      this.redis.hset(this.key('WORKERS'), worker_id, "" + (os.hostname()) + "|" + (server_ip()) + "|" + process.pid + "|" + (Date.now()));
      process.on('uncaughtException', (function(_this) {
        return function(err) {
          if (_this._handler_callback) {
            console.log("Worker [" + (worker_id.split('-')[0]) + "] registered for Task [" + _this.name + "] will block its current processing group");
            return _this._handler_callback({
              "do": 'block',
              message: err.stack
            });
          } else {
            return _this._try_exit();
          }
        };
      })(this));
      process.on('exit', (function(_this) {
        return function() {
          return _this.redis.hdel(_this.key('WORKERS'), worker_id);
        };
      })(this));
      return this._poll();
    };

    Queue.prototype._poll = function() {
      if (exiting) {
        return this._try_exit();
      }
      this.redis.watch(this.key('SOURCE'));
      return this.redis.lindex(this.key('SOURCE'), 0, (function(_this) {
        return function(err, res) {
          var task;
          if (res) {
            task = JSON.parse(res);
            return _this.redis.multi().lpop(_this.key('SOURCE')).rpush("" + (_this.key('QUEUED')) + ":" + task[1], res).exec(function(multi_err, multi_res) {
              if (!(multi_res && multi_res[1] === 1)) {
                return _this._poll();
              }
              return _this._process(task);
            });
          } else {
            _this.redis.unwatch();
            return setTimeout(_this._poll, _this.polling_interval);
          }
        };
      })(this));
    };

    Queue.prototype._try_exit = function() {
      registered_workers.splice(registered_workers.indexOf("" + this.fairy.id + "|" + this.name, 1));
      if (!registered_workers.length) {
        process.exit();
      }
      return log_registered_workers();
    };

    Queue.prototype._process = function(task) {
      var call_handler, errors, handler_callback, processing, retry_count, start_time;
      this.redis.hset(this.key('PROCESSING'), task[0], JSON.stringify(__slice.call(task).concat([start_time = Date.now()])));
      processing = task[0];
      retry_count = this.retry_limit;
      errors = [];
      this._handler_callback = handler_callback = (function(_this) {
        return function(err, res) {
          var finish_time, process_time;
          _this._handler_callback = null;
          if (err) {
            errors.push(err.message || null);
            switch (err["do"]) {
              case 'block':
                _this.redis.multi().rpush(_this.key('FAILED'), JSON.stringify(__slice.call(task).concat([Date.now()], [errors]))).hdel(_this.key('PROCESSING'), processing).sadd(_this.key('BLOCKED'), task[1]).exec();
                return _this._poll();
              case 'block-after-retry':
                if (retry_count--) {
                  return setTimeout(call_handler, _this.retry_delay);
                }
                _this.redis.multi().rpush(_this.key('FAILED'), JSON.stringify(__slice.call(task).concat([Date.now()], [errors]))).hdel(_this.key('PROCESSING'), processing).sadd(_this.key('BLOCKED'), task[1]).exec();
                return _this._poll();
              default:
                if (retry_count--) {
                  return setTimeout(call_handler, _this.retry_delay);
                }
                _this.redis.multi().rpush(_this.key('FAILED'), JSON.stringify(__slice.call(task).concat([Date.now()], [errors]))).hdel(_this.key('PROCESSING'), processing).exec();
            }
          } else {
            finish_time = Date.now();
            process_time = finish_time - start_time;
            _this.redis.multi().hdel(_this.key('PROCESSING'), processing).hincrby(_this.key('STATISTICS'), 'FINISHED', 1).hincrby(_this.key('STATISTICS'), 'TOTAL_PENDING_TIME', start_time - task[task.length - 1]).hincrby(_this.key('STATISTICS'), 'TOTAL_PROCESS_TIME', process_time).lpush(_this.key('RECENT'), JSON.stringify(__slice.call(task).concat([finish_time]))).ltrim(_this.key('RECENT'), 0, _this.recent_size - 1).zadd(_this.key('SLOWEST'), process_time, JSON.stringify(__slice.call(task).concat([start_time]))).zremrangebyrank(_this.key('SLOWEST'), 0, -_this.slowest_size - 1).exec();
          }
          return _this._continue_group(task[1]);
        };
      })(this);
      return (call_handler = (function(_this) {
        return function() {
          return _this.handler.apply(_this, __slice.call(task.slice(1, -1)).concat([(_this._handler_callback = handler_callback)]));
        };
      })(this))();
    };

    Queue.prototype._continue_group = function(group) {
      this.redis.watch("" + (this.key('QUEUED')) + ":" + group);
      return this.redis.lindex("" + (this.key('QUEUED')) + ":" + group, 1, (function(_this) {
        return function(err, res) {
          var task;
          if (res) {
            task = JSON.parse(res);
            _this.redis.unwatch();
            _this.redis.lpop("" + (_this.key('QUEUED')) + ":" + group);
            if (exiting) {
              return _this._requeue_group(group);
            }
            return _this._process(task);
          } else {
            return _this.redis.multi().lpop("" + (_this.key('QUEUED')) + ":" + group).exec(function(multi_err, multi_res) {
              if (!multi_res) {
                return _this._continue_group(group);
              }
              if (exiting) {
                return _this._try_exit();
              }
              return _this._poll();
            });
          }
        };
      })(this));
    };

    Queue.prototype._requeue_group = function(group) {
      this.redis.watch("" + (this.key('QUEUED')) + ":" + group);
      return this.redis.lrange("" + (this.key('QUEUED')) + ":" + group, 0, -1, (function(_this) {
        return function(err, res) {
          var _ref;
          return (_ref = _this.redis.multi()).lpush.apply(_ref, ["" + (_this.key('SOURCE'))].concat(__slice.call(res.reverse()))).del("" + (_this.key('QUEUED')) + ":" + group).exec(function(multi_err, multi_res) {
            if (!multi_res) {
              return _this._requeue_group(group);
            }
            return _this._try_exit();
          });
        };
      })(this));
    };

    Queue.prototype.reschedule = function(callback) {
      var client, reschedule;
      client = create_client(this.fairy.options);
      return (reschedule = (function(_this) {
        return function() {
          client.watch(_this.key('FAILED'));
          client.watch(_this.key('SOURCE'));
          client.watch(_this.key('BLOCKED'));
          client.watch(_this.key('PROCESSING'));
          return client.hlen(_this.key('PROCESSING'), function(err, res) {
            if (res) {
              client.unwatch();
              return reschedule();
            }
            return _this.failed_tasks(function(err, tasks) {
              var requeued_tasks;
              requeued_tasks = [];
              requeued_tasks.push.apply(requeued_tasks, tasks.map(function(task) {
                return JSON.stringify([task.id].concat(__slice.call(task.params), [task.queued.valueOf()]));
              }));
              return _this.blocked_groups(function(err, groups) {
                var group, start_transaction, total_groups, _i, _len, _results;
                if (groups.length) {
                  client.watch.apply(client, groups.map(function(group) {
                    return "" + (_this.key('QUEUED')) + ":" + group;
                  }));
                }
                start_transaction = function() {
                  var multi;
                  multi = client.multi();
                  if (requeued_tasks.length) {
                    multi.lpush.apply(multi, [_this.key('SOURCE')].concat(__slice.call(requeued_tasks.reverse())));
                  }
                  multi.del(_this.key('FAILED'));
                  if (groups.length) {
                    multi.del.apply(multi, groups.map(function(group) {
                      return "" + (_this.key('QUEUED')) + ":" + group;
                    }));
                  }
                  multi.del(_this.key('BLOCKED'));
                  return multi.exec(function(multi_err, multi_res) {
                    if (multi_err) {
                      client.quit();
                      return callback(multi_err);
                    }
                    if (multi_res) {
                      client.quit();
                      return _this.statistics(callback);
                    } else {
                      return reschedule(callback);
                    }
                  });
                };
                if (total_groups = groups.length) {
                  _results = [];
                  for (_i = 0, _len = groups.length; _i < _len; _i++) {
                    group = groups[_i];
                    _results.push(client.lrange("" + (_this.key('QUEUED')) + ":" + group, 1, -1, function(err, res) {
                      requeued_tasks.push.apply(requeued_tasks, res);
                      if (!--total_groups) {
                        return start_transaction();
                      }
                    }));
                  }
                  return _results;
                } else {
                  return start_transaction();
                }
              });
            });
          });
        };
      })(this))();
    };

    Queue.prototype.recently_finished_tasks = function(callback) {
      return this.redis.lrange(this.key('RECENT'), 0, -1, function(err, res) {
        if (err) {
          return callback(err);
        }
        return callback(null, res.map(function(entry) {
          entry = JSON.parse(entry);
          return {
            id: entry[0],
            params: entry.slice(1, -2),
            finished: new Date(entry.pop()),
            queued: new Date(entry.pop())
          };
        }));
      });
    };

    Queue.prototype.failed_tasks = function(callback) {
      return this.redis.lrange(this.key('FAILED'), 0, -1, function(err, res) {
        if (err) {
          return callback(err);
        }
        return callback(null, res.map(function(entry) {
          entry = JSON.parse(entry);
          return {
            id: entry[0],
            params: entry.slice(1, -3),
            reason: entry.pop(),
            failed: new Date(entry.pop()),
            queued: new Date(entry.pop())
          };
        }));
      });
    };

    Queue.prototype.blocked_groups = function(callback) {
      return this.redis.smembers(this.key('BLOCKED'), function(err, res) {
        if (err) {
          return callback(err);
        }
        return callback(null, res.map(function(entry) {
          return entry = JSON.parse(entry);
        }));
      });
    };

    Queue.prototype.slowest_tasks = function(callback) {
      return this.redis.zrevrange(this.key('SLOWEST'), 0, -1, "WITHSCORES", function(err, res) {
        var i;
        if (err) {
          return callback(err);
        }
        res = res.map(function(entry) {
          return JSON.parse(entry);
        });
        return callback(null, ((function() {
          var _i, _ref, _results;
          _results = [];
          for (i = _i = 0, _ref = res.length; _i < _ref; i = _i += 2) {
            _results.push(__slice.call(res[i]).concat([res[i + 1]]));
          }
          return _results;
        })()).map(function(entry) {
          return {
            id: entry[0],
            params: entry.slice(1, -3),
            time: entry.pop(),
            started: new Date(entry.pop()),
            queued: new Date(entry.pop())
          };
        }));
      });
    };

    Queue.prototype.processing_tasks = function(callback) {
      return this.redis.hvals(this.key('PROCESSING'), function(err, res) {
        if (err) {
          return callback(err);
        }
        return callback(null, res.map(function(entry) {
          entry = JSON.parse(entry);
          return {
            id: entry[0],
            params: entry.slice(1, -2),
            start: new Date(entry.pop()),
            queued: new Date(entry.pop())
          };
        }));
      });
    };

    Queue.prototype.source_tasks = function() {
      var args, callback, skip, take, _i;
      args = 2 <= arguments.length ? __slice.call(arguments, 0, _i = arguments.length - 1) : (_i = 0, []), callback = arguments[_i++];
      skip = args[0] || 0;
      take = args[1] || 10;
      return this.redis.lrange(this.key('SOURCE'), skip, skip + take - 1, function(err, res) {
        if (err) {
          callback(err);
        }
        return callback(null, res.map(function(entry) {
          entry = JSON.parse(entry);
          return {
            id: entry[0],
            params: entry.slice(1, -1),
            queued: new Date(entry.pop())
          };
        }));
      });
    };

    Queue.prototype.workers = function(callback) {
      return this.redis.hvals(this.key('WORKERS'), function(err, res) {
        if (err) {
          return callback(err);
        }
        return callback(null, res.map(function(entry) {
          entry = entry.split('|');
          return {
            host: entry[0],
            ip: entry[1],
            pid: parseInt(entry[2]),
            since: new Date(parseInt(entry[3]))
          };
        }).sort(function(a, b) {
          if (a.ip > b.ip) {
            return 1;
          }
          if (a.ip < b.ip) {
            return -1;
          }
          if (a.pid > b.pid) {
            return 1;
          }
          if (a.pid < b.pid) {
            return -1;
          }
        }));
      });
    };

    Queue.prototype.clear = function(callback) {
      this.redis.watch(this.key('SOURCE'));
      this.redis.watch(this.key('PROCESSING'));
      return this.redis.hlen(this.key('PROCESSING'), (function(_this) {
        return function(err, processing) {
          if (err) {
            return typeof callback === "function" ? callback(err) : void 0;
          }
          return _this.redis.keys("" + (_this.key('QUEUED')) + ":*", function(err, res) {
            var _ref;
            if (err) {
              return typeof callback === "function" ? callback(err) : void 0;
            }
            return (_ref = _this.redis.multi()).del.apply(_ref, [_this.key('GROUPS'), _this.key('RECENT'), _this.key('FAILED'), _this.key('SOURCE'), _this.key('STATISTICS'), _this.key('SLOWEST'), _this.key('BLOCKED')].concat(__slice.call(res))).hmset(_this.key('STATISTICS'), 'TOTAL', processing, 'FINISHED', 0, 'TOTAL_PENDING_TIME', 0, 'TOTAL_PROCESS_TIME', 0).exec(function(err, res) {
              if (err) {
                return typeof callback === "function" ? callback(err) : void 0;
              }
              if (!res) {
                return _this.clear(callback);
              }
              if (callback) {
                return _this.statistics(callback);
              }
            });
          });
        };
      })(this));
    };

    Queue.prototype.statistics = function(callback) {
      return this.redis.multi().scard(this.key('GROUPS')).hgetall(this.key('STATISTICS')).hlen(this.key('PROCESSING')).llen(this.key('FAILED')).smembers(this.key('BLOCKED')).hlen(this.key('WORKERS')).exec((function(_this) {
        return function(multi_err, multi_res) {
          var group, multi2, result, statistics, _i, _len, _ref;
          if (multi_err) {
            return callback(multi_err);
          }
          statistics = multi_res[1] || {};
          result = {
            name: _this.name,
            total: {
              groups: multi_res[0],
              tasks: parseInt(statistics.TOTAL) || 0
            },
            finished_tasks: parseInt(statistics.FINISHED) || 0,
            average_pending_time: Math.round(statistics.TOTAL_PENDING_TIME * 100 / statistics.FINISHED) / 100,
            average_process_time: Math.round(statistics.TOTAL_PROCESS_TIME * 100 / statistics.FINISHED) / 100,
            blocked: {
              groups: multi_res[4].length
            },
            processing_tasks: multi_res[2],
            failed_tasks: multi_res[3],
            workers: multi_res[5]
          };
          if (result.finished_tasks === 0) {
            result.average_pending_time = '-';
            result.average_process_time = '-';
          }
          multi2 = _this.redis.multi();
          _ref = multi_res[4];
          for (_i = 0, _len = _ref.length; _i < _len; _i++) {
            group = _ref[_i];
            multi2.llen("" + (_this.key('QUEUED')) + ":" + group);
          }
          return multi2.exec(function(multi2_err, multi2_res) {
            if (multi2_err) {
              return callback(multi2_err);
            }
            result.blocked.tasks = multi2_res.reduce((function(a, b) {
              return a + b;
            }), -result.blocked.groups);
            result.pending_tasks = result.total.tasks - result.finished_tasks - result.processing_tasks - result.failed_tasks - result.blocked.tasks;
            return callback(null, result);
          });
        };
      })(this));
    };

    return Queue;

  })();

}).call(this);