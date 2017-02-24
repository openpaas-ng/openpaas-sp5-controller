const uuid = require('uuid/v4');
const https = require('https');
const fs = require('fs-extra');
const ffmpeg = require('fluent-ffmpeg');

const WebSocket = require('ws');

////////////////////////////////////////////////
// Token Management
////////////////////////////////////////////////

let token = null;

function getToken() {
  // see https://www.microsoft.com/cognitive-services/en-us/speech-api/documentation/API-Reference-REST/BingVoiceRecognition

  // for testing, token can be also be obtained using
  // curl -X POST -H "Ocp-Apim-Subscription-Key: YOURKEY" -d "" https://api.cognitive.microsoft.com/sts/v1.0/issueToken

  let options = {
    hostname:'api.cognitive.microsoft.com',
    port: 443,
    path:'/sts/v1.0/issueToken',
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': '### YOUR KEY HERE ###'
    }
  };

  https.request(options, function(res){
    res.on('data', function(e){
      token = e;
      console.log('---\n\n\ntoken renewed\n\n\n---');
    });
  }).end();
}

// token expires after 10 mins, schedule renewal with a safe margin
getToken();
setTimeout(getToken, 8 * 60 * 1000);

////////////////////////////////////////////////
// Audio Processing
////////////////////////////////////////////////

function convertAudio(content) {
  return new Promise((resolve, reject) => {

    try{
      let buf = new Buffer(content, 'base64');
      fs.writeFile('./res.wav', buf);

      // convert audio to correct format
      let command = ffmpeg('./res.wav')
          .audioCodec('pcm_s16le')
          .output('./converted.wav')
          .on('end', function(){
            fs.readFile('./converted.wav', function(err, data){
              if (err) {
                reject(err);
              }
              resolve(data);
            });
          }).run();
    } catch(err) {
      reject(err);
    }

  });
}

function sendToBing(content){
  return new Promise((resolve, reject) =>{

    var size = fs.statSync('./converted.wav')['size'];

    let options = {
      hostname: 'speech.platform.bing.com',
      path: '/recognize?version=3.0&requestid=' + uuid() + '&appid=D4D52672-91D7-4C74-8AD8-42B1D98141A5&format=json&locale=fr-FR&device.os=none&scenarios=ulm&instanceid=' + uuid(),
      method: 'POST',
      headers: {
        'Authorization': 'Bearer '+ token,
        'Content-type': 'audio/wav; codec=\'audio/pcm\'; samplerate=48000',
        'Content-Length': size
      }
    };

    let req = https.request(options, function(res){
      res.on('data', function(data){
        console.log('result: ' + data);
        try {
          data = JSON.parse(data);
          resolve(data);
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', function(e){
        reject(e);
      });
    });
    req.write(content);
    req.end();

  });
};

////////////////////////////////////////////////
// Jobs processing
////////////////////////////////////////////////

const queue = [];
let processing = false;

function processJob(callback) {
  if(queue.length == 0){
    processing = false;
  } else {
    let audioData = queue.shift();
    console.log('Queue: processing next data (%d jobs left)', queue.length);
    convertAudio(audioData)
      .then(sendToBing)
      .then(
        (result) => {
          console.log('Queue: done processing data\n---');
          callback(result);
          processJob(callback);
        },
        (err) => {
          console.log('Queue: error processing data:');
          console.error(err);
          console.log('---');
          processJob(callback);
        }
    );
  }
}

function processRequest(audioContent, callback){
  queue.push(audioContent);
  if(processing){
    return;
  }
  processing = true;
  processJob(callback);
}

////////////////////////////////////////////////
// Conferences Management
////////////////////////////////////////////////

class Conference {
  constructor(confId) {
    this.id = confId;
    this.ws = new Set([]);
    this.chunks = [];
  }
}


let conferencesHandler = {

  confs: {},

  register: function(confId, ws) {
    // ensure conf exists
    if(!(confId in this.confs)) {
      this.confs[confId] = new Conference(confId);
    }
    this.confs[confId].ws.add(ws);
  },

  unregister: function(confId, ws) {
    if(!(confId in this.confs)) {
      console.error('trying to unregister to non-existing conf ' + confId);
      return;
    }
    this.confs[confId].ws.delete(ws);

    // it was the last registered ws for the conf
    if(this.confs[confId].ws.size == 0) {
      delete this.confs[confId];
    }
  },

  saveTranscriptChunk: function(confId, chunk) {
    if(!(confId in this.confs)) {
      console.error('trying to saveTranscriptionChunk to non-existing conf ' + confId);
      return;
    }
    this.confs[confId].chunks.push(chunk);
  },

  pushEvent: function(confId, event) {
    if(!(confId in this.confs)) {
      console.error('trying to saveTranscriptionChunk to non-existing conf ' + confId);
      return;
    }
    this.confs[confId].ws.forEach((ws) => { ws.send(event); });
  }
};

////////////////////////////////////////////////
// WS Server
////////////////////////////////////////////////

const wss = new WebSocket.Server({
  perMessageDeflate: false,
  port: 9876
});


wss.on('connection', (ws) => {

  ws.on('message', (message) => {
    console.log('received new audio chunk');
    message = JSON.parse(message);

    if (message.type == 'register') {
      conferencesHandler.register(message.confId, ws);
      ws.confId = message.confId;
    }

    if (message.type == 'audioData'){
      let audioContent = message.audioContent.split(',').pop();
      processRequest(audioContent, (data) => {
        if(data.header.status == 'success' && data.results.length > 0){
          try {
            let res = data.results[0].lexical;
            conferencesHandler.pushEvent(message.confId, res);
            conferencesHandler.saveTranscriptChunk(message.confId, res);
          } catch (e) {
            console.error(e);
          }
        }
      });
    }

  });

  ws.on('close', function(e) {
    conferencesHandler.unregister(ws.confId, ws);
  });

  ws.on('error', function(e) {
    conferencesHandler.unregister(ws.confId, ws);
  });

});

