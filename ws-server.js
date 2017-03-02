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

const config = require('./config.json');

const jobProcessing = require('./lib/jobProcessing.js');
const conferencesHandler = require('./lib/conferencesHandler.js');
const speechProcessing = require('./lib/speechengine/thirdparties/microsoft-cognitive/cognitive.js');
speechProcessing.setup(config.speechProcessing.cognitive);
const onlineRecoManager = require('./lib/onlineReco.js');
onlineRecoManager.setup(config.summaryAPI);

////////////////////////////////////////////////
// WS Server
////////////////////////////////////////////////

const wss = new WebSocket.Server({
  perMessageDeflate: false,
  port: config.port
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
          return speechProcessing.audioToTranscript(audioData)
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

app.listen(config.port + 1, function(){
  console.log('REST server listening on port ' + (config.port + 1));
});
