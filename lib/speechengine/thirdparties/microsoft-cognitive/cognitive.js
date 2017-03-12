'use strict';

const uuid = require('uuid/v4');
const https = require('https');
const fs = require('fs-extra');
const ffmpeg = require('fluent-ffmpeg');

module.exports = function(config) {
  let token;

  function getToken(key) {
    // see https://www.microsoft.com/cognitive-services/en-us/speech-api/documentation/API-Reference-REST/BingVoiceRecognition

    const tokenOptions = {
      hostname:'api.cognitive.microsoft.com',
      port: 443,
      path:'/sts/v1.0/issueToken',
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key
      }
    };

    https.request(tokenOptions, function(res){
      res.on('data', function(e){
        token = e;
        console.log('---\n\n\ntoken renewed\n\n\n---');
      });
    }).end();
  };

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
            }).on('error', function(err){
              reject(err);
            }).run();
      } catch(err) {
        reject(err);
      }

    });
  }

  function sendToBing(audioContent){
    return new Promise((resolve, reject) => {

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
        const data = JSON.parse(textContent);
        console.log('result: %j', data);

        if(data.header.status == 'success' && data.results.length > 0){
          textContent = data.results[0].lexical;
          // TODO compute actual segment `from` and `until`
          const time = new Date().getTime();
          resolve([{
            from: time,
            until: time + 1,
            text: textContent
          }]);
        } else {
          reject('data.header: ' + data.header + ', data.results: ' + data.results);
        }
      } catch (e) {
        console.error('error parsing ' + textContent);
        reject(e);
      }

    });
  }

  getToken(config.key);

  // token expires after 10 mins, schedule renewal with a safe margin
  const renewToken = () => { getToken(config.key); };
  setInterval(renewToken, config.renewal);

  return {
    audioToTranscript: (audioContent) => {
      return convertAudio(audioContent)
        .then(sendToBing)
        .then(parseBingAnswer);
    }
  };
};
