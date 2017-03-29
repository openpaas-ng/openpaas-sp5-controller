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
conferencesHandler.scheduleEvent(
  (confId) => {
    onlineRecoManager.getOnlineReco(confId)
      .then(res => {
        const msg = JSON.parse(res);
        if(msg.keywords.length == 0) {
          // this is an empty "dummy" reco, ignore it
          return;
        }
        conferencesHandler.pushEvent(confId, res);
      });
  },
  8000//config.summaryAPI.recoInterval
);

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

  let receivedRegister = false;
  let confId;
  let userId;

  let transcriptManager = {
    transcriptWS: null,
    openPlanned: false,
    bufferedMessages: [],
    open: () => {
      transcriptManager.openPlanned = false;
      transcriptManager.transcriptWS = speechProcessing.getTranscriptSocket((segment) => {
        segment.speaker = userId;
        onlineRecoManager.send({
          from: confId,
          text: segment.from + '\t' + segment.until + '\t' + segment.speaker + '\t' + segment.text
        });
        conferencesHandler.saveTranscriptChunk(confId, segment);
      });
    },
    send: (message) => {
      if(transcriptManager.transcriptWS && transcriptManager.transcriptWS.readyState == WebSocket.OPEN) {
        // empty buffered messages
        while(transcriptManager.bufferedMessages.length > 0){
          transcriptManager.transcriptWS.send(transcriptManager.bufferedMessages.shift());
        }
        transcriptManager.transcriptWS.send(message);
      } else {
        transcriptManager.bufferedMessages.push(message);
        if(transcriptManager.openPlanned ||
           (transcriptManager.transcriptWS && transcriptManager.transcriptWS.readyState == WebSocket.CONNECTING)) {
          console.error('transcriptWS not ready yet');
        } else {
          console.error('transcriptWS not available, trying to reconnect in 500ms ' + transcriptManager.transcriptWS.readyState);
          transcriptManager.openPlanned = true;
          setTimeout(transcriptManager.open, 500);
        }
      }
    },
    close: () => {
      if(transcriptManager.transcriptWS && transcriptManager.transcriptWS.readyState == WebSocket.OPEN) {
        transcriptManager.transcriptWS.send('EOF');
      }
      transcriptManager.transcriptWS.close();
    }
  };

  ws.on('message', (message) => {

    if (!receivedRegister) {
      console.log('new participant registered for conf '+ message.confId);

      message = JSON.parse(message);

      receivedRegister = true;
      confId = message.confId;
      userId = message.userId;

      conferencesHandler.register(confId, ws);
      onlineRecoManager.start(confId);

      transcriptManager.open();
    } else {
      transcriptManager.send(message);
    }
  });

  ws.on('close', function(e) {
    conferencesHandler.unregister(confId, ws);
    transcriptManager.close();
  });

});

sserver.listen(config.port);
