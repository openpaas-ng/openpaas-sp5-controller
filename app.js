const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');
const express = require('express');
const bodyParser = require('body-parser');

const config = require('./config.json');

const jobProcessing = require('./lib/jobProcessing.js');
const conferencesHandler = require('./lib/conferencesHandler.js');
const onlineRecoManager = require('./lib/onlineReco.js')(config.summaryAPI);

const speechProcessing = function(){
  switch(config.speechProcessing.backend) {
  case 'kaldi':
    return require('./lib/speechengine/kaldi/kaldi.js')(config.speechProcessing.kaldi);
  case 'cognitive':
    return require('./lib/speechengine/thirdparties/microsoft-cognitive/cognitive.js')(config.speechProcessing.cognitive);
  default:
    throw new Error('unknown speech processing backend ' +
                    config.speechProcessing.backend);
  }
}();

// schedule reco for all active meeting every `recoInterval` ms
setInterval(
  () => {
    for (let confId in conferencesHandler.confs) {
      onlineRecoManager.getOnlineReco(confId)
        .then(res => conferencesHandler.pushEvent(confId, res));
    }
  }, config.summaryAPI.recoInterval);

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

const credentials = {
  key: fs.readFileSync(config.ssl.key, 'utf8'),
  cert: fs.readFileSync(config.ssl.cert, 'utf8')
};

const sserver = https.createServer(credentials, app);

////////////////////////////////////////////////
// WS Server
////////////////////////////////////////////////

const wss = new WebSocket.Server({
  server: sserver,
  perMessageDeflate: false
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
            .then((transContent) => {
              return new Promise((resolve, reject) => {

                if(transContent.length == 0) {
                  reject('empty transContent');
                } else {
                  // collapse all transcript segments into one
                  const user = message.userId;
                  const startTime = transContent[0].from;
                  let endTime;
                  let fullTranscript = '';

                  for (let transSegment of transContent) {
                    endTime = transSegment.until;
                    fullTranscript += transSegment.text + ' ';
                  }

                  onlineRecoManager.send({
                    from: message.confId,
                    text: startTime + '\t' + endTime + '\t' + user + '\t' + fullTranscript
                  });

                  conferencesHandler.saveTranscriptChunk(message.confId,
                                                         { 'from': startTime,
                                                           'until': endTime,
                                                           'speaker': user,
                                                           'text': fullTranscript
                                                         });

                  resolve(transContent);
                }
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

sserver.listen(config.port);
