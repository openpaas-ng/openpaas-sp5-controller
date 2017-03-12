'use strict';

const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const W3CWebSocket = require('websocket').w3cwebsocket;

module.exports = function(config) {

  function convertAudio(audioContent) {
    return new Promise((resolve, reject) => {

      try{
        let buf = new Buffer(audioContent, 'base64');
        fs.writeFile('./res.wav', buf);

        // convert audio to correct format
        let command = ffmpeg('./res.wav')
          .output('./converted.wav')
          .setStartTime(0)
          .audioFrequency(16000)
          .audioChannels(1)
          .toFormat('wav')
          .on('end', function(){
            fs.readFile('./converted.wav', function(err, data){

              // cleanup files
              fs.unlink('./res.wav');
              fs.unlink('./converted.wav');

              if (err) {
                reject(err);
              } else {
                resolve(data);
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

  function transcribeClip(audioContent) {
    return new Promise((resolve, reject) => {

      let outputContent = [];

      let ws = new W3CWebSocket(config.gstreamerURL + "/client/ws/speech");

      ws.onopen = function (event) {
        console.info('ws to stt module open');
        ws.send(audioContent);
        ws.send("EOS");
      };

      ws.onclose = function (event) {
        console.info('ws to stt module closed');
        resolve(outputContent);
      };
      ws.onerror = function (event) {
        console.info('ws to stt module error: ' + event);
      };

      let nbSegment = 0;
      ws.onmessage = function (event) {
        var hyp = JSON.parse(event.data);
        if (hyp["result"]!= undefined && hyp["result"]["final"]){

          console.log('result: %j', hyp);

          let trans = ((hyp["result"]["hypotheses"])[0])["transcript"];
          let start;
          let end;
          if(hyp["segment-start"] && hyp["segment-length"]) {
            start = JSON.parse(hyp["segment-start"]);
            end = parseFloat(hyp["segment-start"])+parseFloat(hyp["segment-length"]);
          } else {
            start = nbSegment; // TODO set the actual start
            end = nbSegment + 1; // TODO set the actual duration
          }

          outputContent.push({
            from: start,
            until: end,
            text: trans
          });

          nbSegment += 1;
        }
      };
    });
  };
  return {
    audioToTranscript: (audioContent) => {
      return convertAudio(audioContent)
        .then(transcribeClip);
    }
  };
};
