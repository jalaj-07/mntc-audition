const express = require("express");
const { MongoClient } = require("mongodb");
const hasher = require("pbkdf2-password")();
const session = require("express-session");

// Load configuration from a local .env file
require("dotenv").config();

const app = (module.exports = express());
var database = {
  client: new MongoClient(
    `mongodb://${process.env.DB_HOST || "localhost"}:${
      process.env.DB_PORT || 27017
    }`
  ),
  server: null,
  db: null,
  userCollection: null,
  questionsCollection: null,
};

app.use(express.json());

// Session middleware
app.use(
  session({
    resave: false, // don't save session if unmodified
    saveUninitialized: false, // don't create session until something stored
    secret: process.env.SECRET_KEY || "some-secret-key",
  })
);

// User authenticator function
function authenticate(name, pass) {
  console.log("authenticating %s", name);
  return new Promise((resolve, reject) => {
    database.userCollection.findOne({ username: name }).then((user) => {
      if (!user) reject("cannot find user");
      else
        hasher({ password: pass, salt: user.salt }, function (err, _, _, hash) {
          if (err) reject(err);
          // TODO: Use a constant time comparison function instead
          if (hash === user.password) resolve(user);
          else reject("invalid password");
        });
    });
  });
}

// Middleware for restricted access paths
function restrict(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect("/login");
  }
}

// Close MongoDB client and shutdown server
function gracefulShutdown() {
  console.log("Attempting graceful shutdown...");
  database.client.close();
  if (server) server.close();
}

app.get("/", function (_, res) {
  res.redirect("/login");
});

// Get the question
app.get("/question", restrict, function (req, res) {
  database.questionsCollection
    .findOne({ number: req.session.user.level })
    .then((question) => {
      if (question) {
        res.send({ question: question.text });
      } else {
        res.status(404).send("Could not find this question");
      }
    });
});

// Post the answer
app.post("/answer", restrict, (req, res) => {
  database.questionsCollection
    .findOne({ number: req.session.user.level, answer: req.body.answer })
    .then((answer) => {
      if (!answer) {
        res.send({ correct: false });
      }

      // End of Quiz
      else if (req.session.user.level === 10) {
        res.send({ correct: true, gameOver: true });
      }

      // User goes to next level
      else {
        database.userCollection
          .updateOne(
            { user: req.session.user.username },
            { $set: { level: req.session.user.level + 1 } }
          )
          .then((_) => {
            req.session.user.level += 1;
            res.send({ correct: true });
          })
          .catch((msg) => {
            console.error("Server has encountered 500");
            console.error(msg);
            res.status(500).send(msg);
          });
      }
    })
    .catch((msg) => {
      console.error("Server has encountered 500");
      console.error(msg);
      res.status(500).send(msg);
    });
});

// Logout the user
app.get("/logout", function (req, res) {
  req.session.destroy(function () {
    res.redirect("/");
  });
});

// User login
app.post("/login", function (req, res) {
  authenticate(req.body.username, req.body.password)
    .then((user) => {
      if (user) {
        // Regenerate session when signing in
        // to prevent fixation
        req.session.regenerate(function () {
          // Store the user's username
          // in the session store to be retrieved,
          req.session.user = { name: user.username, level: user.level };
          res.send({ auth: true, msg: "User authenticated successfully" });
        });
      } else {
        res.redirect("/login");
      }
    })
    .catch((err) => {
      console.log("Could not authenticate user: " + err);
      res.status(413).send({ auth: false, msg: err });
    });
});

app.post("/signup", (req, res) => {
  if (!req.body.username || !req.body.password) {
    res.status(400).send({
      success: false,
      msg: "Request does not contain username and password",
    });
  } else {
    database.userCollection
      .findOne({ username: req.body.username })
      .then((data) => {
        if (data) {
          res
            .status(400)
            .send({ success: false, msg: "Username is already in use" });
        } else {
          // Hash password before storage
          hasher({ password: req.body.password }, (err, _, salt, hash) => {
            if (err) {
              res.status(500);
              console.log(err);
              res.send({ success: false, msg: "Failed to create user" });
            }

            // Save user to database
            database.userCollection
              .insertOne({
                username: req.body.username,
                password: hash,
                salt: salt,
                level: 1,
              })
              .then((_) =>
                res.send({ success: true, msg: "User created successfully" })
              )
              .catch((err) => {
                res.status(500);
                console.log(err);
                res.send({ success: false, msg: "Failed to create user" });
              });
          });
        }
      })
      .catch((err) => {
        res.status(500);
        console.log(err);
        res.send("Failed to create user");
      });
  }
});

app.get("/login", (req, res) => {
  res.send("<h1>Login Page</h1>");
});

// Starts the application
function start() {
  // Connect to MongoDB
  console.log("Connecting to MongoDB...");
  database.client
    .connect()
    .then(() => {
      // Populate the `database` object
      database.db = database.client.db("mntc");
      database.userCollection = database.db.collection("users");
      database.questionsCollection = database.db.collection("questions");

      console.log("Connected to MongoDB.\nStarting HTTP server...");

      //Start the server
      server = app.listen(
        process.env.PORT || 3000,
        process.env.HOST || "localhost"
      );
      server.on("listening", () =>
        console.log(
          "Server listening on: http://" +
            server.address().address +
            ":" +
            server.address().port
        )
      );

      // On server errors
      server.on("error", (err) => {
        console.error("Server encountered error: ");
        console.error(err.message);
        gracefulShutdown();
      });
    })
    .catch((err) => {
      console.error("Failed to connect to MongoDB server.");
      console.error(err.message);
      gracefulShutdown();
    });
}

start();
