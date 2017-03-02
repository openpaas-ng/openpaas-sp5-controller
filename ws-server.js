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
const conferencesHandler = require('./lib/conferencesHandler.js');
const speechProcessing = require('./lib/speechengine/thirdparties/microsoft-cognitive/cognitive.js');

speechProcessing.setup({
  key: # YOUR KEY HERE #,
  renewal: 8 * 60 * 1000
});

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

app.listen(port + 1, function(){
  console.log('REST server listening on port ' + (port + 1));
});
