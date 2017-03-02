const uuid = require('uuid/v4');
const http = require('http');
const https = require('https');
const fs = require('fs-extra');
const ffmpeg = require('fluent-ffmpeg');

const WebSocket = require('ws');
const Stomp = require('stompjs');
const Sock = require('sockjs-client');
const express = require('express');
const bodyParser = require('body-parser');

const Client = require('node-rest-client').Client;
const client = new Client();

const callbackIP = '172.17.0.1';
const port = 9876;

const recoSummaryAPIEndpoint = 'localhost';
const recoSummaryAPIPort = 8090;

const jobProcessing = require('./lib/jobProcessing.js');
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

function convertAudio(audioContent) {
  return new Promise((resolve, reject) => {

    try{
      let buf = new Buffer(audioContent, 'base64');
      fs.writeFile('./res.wav', buf);

      // convert audio to correct format
      let command = ffmpeg('./res.wav')
        .audioCodec('pcm_s16le')
        .output('./converted.wav')
        .audioFrequency(16000)
        .audioChannels(1)
        .on('end', function(){
          fs.readFile('./converted.wav', function(err, data){
            if (err) {
              reject(err);
            } else {
              audioContent = data;
              resolve(audioContent);
            }
          });
        }).run();
    } catch(err) {
      reject(err);
    }

  });
}

function sendToBing(audioContent){
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
        const textContent = data;
        resolve(textContent);
      });
      res.on('error', function(e){
        reject(e);
      });
    });
    req.write(audioContent);
    req.end();

  });
};

function parseBingAnswer(textContent) {
  return new Promise((resolve, reject) => {

    try {
      let data = JSON.parse(textContent);
      console.log('result: %j', data);

      if(data.header.status == 'success' && data.results.length > 0){
        textContent = data.results[0].lexical;
        resolve(textContent);
      } else {
        reject('data.header: ' + data.header + ', data.results: ' + data.results);
      }
    } catch (e) {
      console.error('error parsing ' + textContent);
      reject(e);
    }

  });
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
// Online reco
////////////////////////////////////////////////

//const RecoWSClient = new WebSocket('ws://' + recoSummaryAPIEndpoint + '/chat');
const recoStompClient = Stomp.over(new Sock('http://'+ recoSummaryAPIEndpoint+ ':' + recoSummaryAPIPort + '/chat'));
recoStompClient.connect();

// schedule reco for all active meeting every `recoInterval` ms
const recoInterval = 10000;
setInterval(function(){
  for (let confId in conferencesHandler.confs) {
    let options = {
      hostname: recoSummaryAPIEndpoint,
      port: recoSummaryAPIPort,
      path: '/resources?id=' + confId + '&resources=keywords;so',
      method: 'GET',
      headers: {
        'Content-type': 'application/json'
      }
    };

    let req = http.get(options, function(response){
      var body = '';
      response.on('data', function(d) {
        body += d;
      });
      response.on('end', () =>{
        conferencesHandler.pushEvent(confId, body);
      });
    });
  }
}, recoInterval);

const onlineRecoManager = {
  start: function(id) {
    let args = {
      parameters: {'id': id,
                   'action': 'START'},
      headers: { 'Content-Type': 'application/json' }
    };

    client.get('http://' + recoSummaryAPIEndpoint + ':' + recoSummaryAPIPort + '/stream', args, function (data, response) {
      console.log('Online reco: started for conf %s', id);
    });
  },
  stop: function(id) {
    let args = {
      parameters: {'id': id,
                   'action': 'STOP'},
      headers: { 'Content-Type': 'application/json' }
    };

    client.get('http://' + recoSummaryAPIEndpoint + ':' + recoSummaryAPIPort + '/stream', args, function (data, response) {
      console.log('Online reco: stop for conf %s', id);
    });
  },
  send: function(content) {
    recoStompClient.send('/app/chat', {}, JSON.stringify(content));
  }
};

////////////////////////////////////////////////
// WS Server
////////////////////////////////////////////////

const wss = new WebSocket.Server({
  perMessageDeflate: false,
  port: port
});

wss.on('connection', (ws) => {

  ws.on('message', (message) => {
    message = JSON.parse(message);

    if (message.type == 'register') {
      console.log('new participant registered for conf '+ message.confId);
      conferencesHandler.register(message.confId, ws);
      ws.confId = message.confId;
      onlineRecoManager.start(message.confId);
    }

    if (message.type == 'audioData'){
      console.log('received new audio chunk for conf ' + message.confId);
      let audioContent = message.audioContent.split(',').pop();

      jobProcessing.processJob({
        data: audioContent,
        process: (audioData) => {
          return convertAudio(audioData)
            .then(sendToBing)
            .then(parseBingAnswer)
            .then((textContent) => {
              return new Promise((resolve, reject) => {
                const time = new Date();
                const entry = {
                  from: message.confId,
                  text: time.getTime() + '\t' + (time.getTime() + 1) + '\t' + 'placeholder' + '\t' + textContent
                };
                onlineRecoManager.send(entry);
                conferencesHandler.saveTranscriptChunk(message.confId, textContent);

                resolve(textContent);
              });
            });
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


////////////////////////////////////////////////
// REST server
////////////////////////////////////////////////

const app = express();
app.use(bodyParser.json());

app.post('/api/summaries/:id', function(req, res){
  console.log('received summary for conf %s : %j', req.params.id, req.body);
  conferencesHandler.pushEvent(req.params.id, JSON.stringify(req.body));
  res.send('OK');
});

app.listen(port + 1, function(){
  console.log('REST server listening on port ' + (port + 1));
});
