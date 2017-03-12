const WebSocket = require('ws');
const express = require('express');
const bodyParser = require('body-parser');

const config = require('./config.json');

const jobProcessing = require('./lib/jobProcessing.js');
const conferencesHandler = require('./lib/conferencesHandler.js');
const speechProcessing = require('./lib/speechengine/thirdparties/microsoft-cognitive/cognitive.js')(config.speechProcessing.cognitive);
const onlineRecoManager = require('./lib/onlineReco.js')(config.summaryAPI);


// schedule reco for all active meeting every `recoInterval` ms
setInterval(
  () => {
    for (let confId in conferencesHandler.confs) {
      onlineRecoManager.getOnlineReco(confId)
        .then(res => conferencesHandler.pushEvent(confId, res));
    }
  }, config.summaryAPI.recoInterval);

////////////////////////////////////////////////
// WS Server
////////////////////////////////////////////////

const wss = new WebSocket.Server({
  perMessageDeflate: false,
  port: config.ws.port
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
      console.log('received new audio chunk for conf %s from %s', message.confId, message.userId);
      let audioContent = message.audioContent.split(',').pop();

      jobProcessing.processJob({
        data: audioContent,
        process: (audioData) => {
          return speechProcessing.audioToTranscript(audioData)
            .then((textContent) => {
              return new Promise((resolve, reject) => {

                const user = message.userId;
                const time = new Date();
                const entry = {
                  from: message.confId,
                  text: time.getTime() + '\t' + (time.getTime() + 1) + '\t' + user + '\t' + textContent
                };
                onlineRecoManager.send(entry);
                conferencesHandler.saveTranscriptChunk(message.confId,
                                                       { 'from': time.getTime(),
                                                         'until': time.getTime() +1,
                                                         'speaker': user,
                                                         'text': textContent
                                                       });

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

app.get('/api/transcripts/:id', function(req, res){
  console.log('received request for transcript %s', req.params.id);
  if(!(req.params.id in conferencesHandler.confs)) {
    res.sendStatus(404);
  } else {
    res.send(JSON.stringify(conferencesHandler.getTranscript(req.params.id)));
  }
});

app.post('/api/summaries/:id', function(req, res){
  console.log('received summary for conf %s : %j', req.params.id, req.body);
  conferencesHandler.pushEvent(req.params.id, JSON.stringify(req.body));
  res.send('OK');
});

app.listen(config.rest.port, function(){
  console.log('REST server listening on port ' + (config.rest.port));
});
