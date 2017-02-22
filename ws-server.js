const uuid = require('uuid/v4');
const https = require('https');
const fs = require('fs-extra');
const ffmpeg = require('fluent-ffmpeg');

const WebSocket = require('ws');

////////////////////////////////////////////////
// Token Management
////////////////////////////////////////////////

var token = null;

function getToken() {
  // see https://www.microsoft.com/cognitive-services/en-us/speech-api/documentation/API-Reference-REST/BingVoiceRecognition

  // for testing, token can be also be obtained using
  // curl -X POST -H "Ocp-Apim-Subscription-Key: YOURKEY" -d "" https://api.cognitive.microsoft.com/sts/v1.0/issueToken

  var options = {
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

function convertAudio(content, callback) {
  var buf = new Buffer(content, 'base64');
  fs.writeFile('./res.wav', buf);

  // convert audio to correct format
  var command = ffmpeg('./res.wav')
      .audioCodec('pcm_s16le')
      .output('./converted.wav')
      .on('end', function(){
        fs.readFile('./converted.wav', function(err, data){
          if (err) {
            console.error(err);
            return;
          }

          callback(data);
        });
      }).run();
}

function sendToBing(content, callback){

  var options = {
    hostname: 'speech.platform.bing.com',
    path: '/recognize?version=3.0&requestid=' + uuid() + '&appid=D4D52672-91D7-4C74-8AD8-42B1D98141A5&format=json&locale=fr-FR&device.os=none&scenarios=ulm&instanceid=' + uuid(),
    method: 'POST',
    headers: {
      'Authorization': 'Bearer '+ token,
      'Content-type': 'audio/wav; codec=\'audio/pcm\'; samplerate=48000',
      'Content-Length': 357878
    }
  };

  var req = https.request(options, function(res){
    res.on('data', function(data){
      console.log('result: ' + data +'\n---');
      try {
        data = JSON.parse(data);
        if(data.header.status == 'success' && data.results.length > 0){
          callback(data.results[0].lexical);
        }
      } catch (e) {
        console.error(e);
      }
    });
    res.on('error', function(e){
      console.error(e);
    });
  });
  req.write(content);
  req.end();
};

////////////////////////////////////////////////
// Jobs processing
////////////////////////////////////////////////

function processRequest(audioContent, callback){
  convertAudio(audioContent, (data) => {
    sendToBing(data, (result) => { callback(result); });
  });
}

////////////////////////////////////////////////
// WS Server
////////////////////////////////////////////////

const wss = new WebSocket.Server({
  perMessageDeflate: false,
  port: 9876
});


wss.on('connection', function connection(ws) {
  ws.on('message', function incoming(message) {
    try {
      console.log('received new audio chunk');
      var audioContent = message.split(',').pop();
      processRequest(audioContent, (result) => { ws.send(result); });
    } catch (e) {
      console.error(e);
    }
  });
});

