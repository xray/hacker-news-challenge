
const functions = require('firebase-functions');
const admin = require("firebase-admin");
const axios = require("axios");

const serviceAccount = require("./fbKeys/hnc-firebase-admin.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://hacker-news-challenge.firebaseio.com"
});

const db = admin.firestore();
const settings = {timestampsInSnapshots: true};
db.settings(settings);

exports.update_news = functions.pubsub.topic('update-news').onPublish((event) => {
  let storyIds = [];

  let getStoriesRequests = (idsList = storyIds) => {
    return new Promise((resolve, reject) => {
      storiesRequestList = [];
      for (id in idsList) {
        storiesRequestList.push(
          axios.request({
            responseType: 'json',
            url: 'https://hacker-news.firebaseio.com/v0/item/' + idsList[id] + '.json',
            method: 'get'
          })
        );
      }
      resolve(axios.all(storiesRequestList));
    });
  }

  let retryCollect = () => {
    return new Promise((resolve, reject) => {
      let retry = () => {
        resolve(getStoriesRequests());
      }
      setTimeout(retry, 3000)
    });
  }

  let failedAttempt = (err, attempt) => {
    console.error("Failed to gather all the stories...");
    console.error(`Failed at: ${err.config.url}`);
    console.log(`Retrying in 3 seconds... (Attempt ${attempt}/5)`);
    return retryCollect();
  }

  let deleteCollection = (db, collectionPath, batchSize) => {
    var collectionRef = db.collection(collectionPath);
    var query = collectionRef.orderBy('__name__').limit(batchSize);
  
    return new Promise((resolve, reject) => {
      deleteQueryBatch(db, query, batchSize, resolve, reject);
    });
  }
  
  let deleteQueryBatch = (db, query, batchSize, resolve, reject) => {
    query.get()
      .then((snapshot) => {
        // When there are no documents left, we are done
        if (snapshot.size === 0) {
          return 0;
        }

        // Delete documents in a batch
        var batch = db.batch();
        snapshot.docs.forEach((doc) => {
          batch.delete(doc.ref);
        });

        return batch.commit().then(() => {
          return snapshot.size;
        });
      }).then((numDeleted) => {
        if (numDeleted === 0) {
          resolve();
          return;
        }

        // Recurse on the next process tick, to avoid
        // exploding the stack.
        process.nextTick(() => {
          deleteQueryBatch(db, query, batchSize, resolve, reject);
        });
      })
      .catch(reject);
  }

  axios.get('https://hacker-news.firebaseio.com/v0/topstories.json').then((res) => {
    return res.data;
  }).then((ids) => {
    storyIds = ids;
    return getStoriesRequests(storyIds);
  }).catch((err) => {
    return failedAttempt(err, 1);
  }).catch((err) => {
    return failedAttempt(err, 2);
  }).catch((err) => {
    return failedAttempt(err, 3);
  }).catch((err) => {
    return failedAttempt(err, 4);
  }).catch((err) => {
    return failedAttempt(err, 5);
  }).then((responses) => {
    let storiesData = {stories: {}};
    for (stories in responses) {
      let story = responses[stories].data
      let url = ""
      if (story.url === undefined) {
        url = "No URL";
      } else {
        url = story.url;
      }
      storiesData.stories[stories] = {
        id: story.id,
        title: story.title,
        author: story.by,
        score: story.score,
        url: url,
        time: story.time
      }
    }
    return storiesData;
  }).then((stories) => {
    return Promise.all([deleteCollection(db, "stories", 100), stories]);
  }).then(([p1, stories]) => {
    console.log("Starting the database portion");
    let storiesList = stories["stories"];
    let dbCalls = [];
    for (story in storiesList) {
      dbCalls.push(db.collection("stories").doc(story).set(storiesList[story]));
    }
    return dbCalls
  }).then((dbCalls) => {
    return Promise.all(dbCalls)
  }).then((values) => {
    return true;
  }).catch((err) => {
    console.log(err);
    return false;
  });
});

exports.testUpdate = functions.https.onRequest((req, res) => {
  let getStoriesRequests = (idsList = storyIds) => {
    return new Promise((resolve, reject) => {
      storiesRequestList = [];
      for (id in idsList) {
        storiesRequestList.push(
          axios.request({
            responseType: 'json',
            url: 'https://hacker-news.firebaseio.com/v0/item/' + idsList[id] + '.json',
            method: 'get'
          })
        );
      }
      resolve(storiesRequestList);
    });
  }

  let allRequests = () => {
    return new Promise((resolve, reject) => {
      axios.get('https://hacker-news.firebaseio.com/v0/topstories.json').then((res) => {
        return res.data;
      }).then((idList) => {
        return getStoriesRequests(idList);
      }).then((reqList) => {
        return resolve(reqList);
      }).catch((err) => {
        return reject(new Error(err));
      })
    })
  }

  let makeRequests = (requests) => {
    return new Promise((resolve, reject) => {
      failedRequests = [];
      let collectedStories = {stories: {}};
      for (request in requests) {
        console.log(`Starting ${request} of ${requests.length}`);
        requests[request].then((response) => {
          return response.data;
        }).then((result) => {
          let url = ""
          if (result.url === undefined) {
            url = "No URL";
          } else {
            url = result.url;
          }
          collectedStories.stories[result.id] = {
            title: result.title,
            author: result.by,
            score: result.score,
            url: url,
            time: result.time
          }
          return result.id;
        }).then((data) => {
          // console.log(`Added "${data}" to list...`);
          let compareMe = parseInt(request) + 1;
          console.log(compareMe + "/" + requests.length);
          if (compareMe >= (requests.length - 1)) {
            console.log(`Failed Requests: ${failedRequests.length}`);
            return resolve(collectedStories);
          } else {
            // console.log(`Request ${request} of ${requests.length}`);
            return
          }
        }).catch((error) => {
          // console.error(`There was a problem getting ${error.config.url}...`);
          console.error(error);
          failedRequests.push(
            axios.request({
              responseType: 'json',
              url: error.config.url,
              method: 'get'
            })
          );
          return
        });
      }
    });
  }
  
  allRequests().then((requests) => {
    return makeRequests(requests);
  }).then((result) => {
    return res.status(200).json(result);
  }).catch((err) => {
    console.log(err);
    return res.status(500).send("That didn't work...");
  });
});

exports.getCachedStories = functions.https.onRequest((req, res) => {
  const storyRef = db.collection('stories');
  const allStories = storyRef.get()
  .then(snapshot => {
    let storiesData = {stories: {}};
    console.time("Transform Data");
    snapshot.forEach(doc => {
      storiesData.stories[doc.id] = {
        title: doc.data().title,
        author: doc.data().author,
        score: doc.data().score,
        url: doc.data().url,
        time: doc.data().time
      }
    });
    orderedStories = {stories: {}};
    Object.keys(storiesData['stories']).sort().forEach((key) => {
      orderedStories['stories'][key] = storiesData['stories'][key];
    });
    console.timeEnd("Transform Data");
    return res.status(200).json(orderedStories);
  }).catch((err) => {
    console.error('Failed to get data...');
    console.error(err);
    return res.status(500).send('Internal Server Error');
  });
});