// Socket.io server that will service both node
// and react clients
// Req:
// - farmhash

// entrypoint for our cluster which will make workers
// and the workers will do the Socket.io handling
//See https://github.com/elad/node-cluster-socket.io

const express = require("express");
const expressip = require('express-ip');
const path = require("path");
const morgan = require('morgan')
const cookieParser = require("cookie-parser");
const cluster = require("cluster");
const net = require("net");
const helmet = require('helmet');
const fileUpload = require('express-fileupload');
const useragent = require('express-useragent');
const _ = require("lodash");
const ErrorStackParser = require('error-stack-parser');

const dotenv = require("dotenv");
var cors = require("cors");
dotenv.config();

// eslint-disable-next-line no-undef
const port = normalizePort(process.env.PORT || "3000");

const num_processes = require("os").cpus().length;
// Brew breaks for me more than it solves a problem, so I
// installed redis from https://redis.io/topics/quickstart
// have to actually run redis via: $ redis-server (go to location of the binary)
// check to see if it's running -- redis-cli monitor
// const io_redis = require("socket.io-redis");
const farmhash = require("farmhash");
const gateway = require("./gateway");

if (cluster.isMaster) {
  // This stores our workers. We need to keep them to be able to reference
  // them based on source IP address. It's also useful for auto-restart,
  // for example.
  let workers = [];

  // Helper function for spawning worker at index 'i'.
  let spawn = function (i) {
    workers[i] = cluster.fork();

    // Optional: Restart worker on exit
    // eslint-disable-next-line no-unused-vars
    workers[i].on("exit", function (code, signal) {
      // console.log('respawning worker', i);
      spawn(i);
    });
  };

  // Spawn workers.
  for (var i = 0; i < num_processes; i++) {
    spawn(i);
  }

  // Helper function for getting a worker index based on IP address.
  // This is a hot path so it should be really fast. The way it works
  // is by converting the IP address to a number by removing non numeric
  // characters, then compressing it to the number of slots we have.
  //
  // Compared against "real" hashing (from the sticky-session code) and
  // "real" IP number conversion, this function is on par in terms of
  // worker index distribution only much faster.
  const worker_index = function (ip, len) {
    return farmhash.fingerprint32(ip) % len; // Farmhash is the fastest and works with IPv6, too
  };

  // in this case, we are going to start up a tcp connection via the net
  // module INSTEAD OF the http module. Express will use http, but we need
  // an independent tcp port open for cluster to work. This is the port that
  // will face the internet
  const server = net.createServer({ pauseOnConnect: true }, (connection) => {
    // We received a connection and need to pass it to the appropriate
    // worker. Get the worker for this connection's source IP and pass
    // it the connection.
    let worker = workers[worker_index(connection.remoteAddress, num_processes)];
    worker.send("sticky-session:connection", connection);
  });
  server.listen(port);

  console.log(`Master listening on port ${port}`);
} else {
  // Note we don't use a port here because the master listens on it for us.
  let app = express();

  app.set('trust proxy', true);

  app.use(expressip().getIpInfoMiddleware);
  app.use(cors());

  app.use(useragent.express());

  let _format = ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
  app.use(morgan(_format));
  app.use(helmet.crossOriginResourcePolicy({ policy: "cross-origin" }));
  app.use(helmet.dnsPrefetchControl());
  app.use(helmet.expectCt());
  app.use(helmet.frameguard());
  app.use(helmet.hidePoweredBy());
  app.use(helmet.hsts());
  app.use(helmet.ieNoOpen());
  app.use(helmet.noSniff());
  app.use(helmet.permittedCrossDomainPolicies());
  app.use(helmet.referrerPolicy());
  app.use(helmet.xssFilter());
  // end helmet

  //fileSize: 5000 * 1024 * 1024; // 500MB
  app.use(fileUpload({
    limits: { fileSize: 5000 * 1024 * 1024 },
    useTempFiles: true
  }));


  app.use(express.json({ limit: "500mb" }));
  app.use(express.urlencoded({ extended: true, limit: "500mb" }));
  app.use(cookieParser());
  // eslint-disable-next-line no-undef
  app.use('/tmp', express.static(path.join(__dirname, 'tmp')))
  // eslint-disable-next-line no-undef
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')))
  // eslint-disable-next-line no-undef
  app.use(express.static(path.join(__dirname, "public")));

  gateway(app);

  // Add this middleware
  // error handler
  // eslint-disable-next-line no-unused-vars
  app.use(function (err, req, res, next) {

    let _body = {
      message: 'Internal Server Error',
      details: ""
    }
    // eslint-disable-next-line no-undef
    if (process.env.ENVIRONMENT == 'development') {
      // render the error page
      // console.error(err);
      let e = ErrorStackParser.parse(err);
      _body.message = err.message;
      e = _.map(e, (i) => {
        i = _.omit(i, ['fileName', 'source']);
        return i;
      });
      _body.details = e;
    }
    res.status(err.status || 500);
    res.json(_body)
  });

  // Don't expose our internal server to the outside world.
  const server = app.listen(0, "localhost");
  // console.log("Worker listening...");
  //---------------------------------------------------------------------
  // Listen to messages sent from the master. Ignore everything else.
  // eslint-disable-next-line no-undef
  process.on("message", function (message, connection) {
    if (message !== "sticky-session:connection") {
      return;
    }
    // Emulate a connection event on the server by emitting the
    // event with the connection the master sent us.
    server.emit("connection", connection);
    connection.resume();
  });
}

function normalizePort(val) {
  var port = parseInt(val, 10);
  if (isNaN(port)) {
    // named pipe
    return val;
  }
  if (port >= 0) {
    // port number
    return port;
  }
  return false;
}


