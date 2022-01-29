/**
 * Script for populating the database with questions that are stored in the
 * questions.json file in the local directory
 */

require("dotenv").config();

const { MongoClient } = require("mongodb");
const questions = require("./questions.json");

const client = new MongoClient(
  `mongodb://${process.env.DB_HOST || "localhost"}:${
    process.env.DB_PORT || 27017
  }`
);

function start() {
  console.log("Connecting to server...");
  client
    .connect()
    .then((_) => {
      const database = client.db("mntc");
      const collection = database.collection("questions");

      collection
        .insertMany(questions)
        .then((_) => {
          console.log("Questions populated into database successfully");
          client.close();
        })
        .catch((err) => {
          console.error("Failed to connect to server");
          console.error(err);
        });
    })
    .catch((err) => {
      console.error("Failed to connect to server");
      console.error(err);
    });
}

// Wrapping the entire application in a try catch block so
// that client can disconnect before exiting.
try {
  start();
} catch (err) {
  try {
    client.close();
  } catch {}
  throw err;
}
