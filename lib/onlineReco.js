'use strict';

const http = require('http');
const Stomp = require('stompjs');
const Sock = require('sockjs-client');
const Client = require('node-rest-client').Client;
const client = new Client();

module.exports = function(config) {
  let recoStompClient =  Stomp.over(new Sock('http://'+ config.host+ ':' + config.port + '/chat'));
  recoStompClient.connect();

  return {
    start: function(id) {
      let args = {
        parameters: {'id': id,
                     'action': 'START'},
        headers: { 'Content-Type': 'application/json' }
      };

      client.get('http://' + config.host + ':' + config.port + '/stream', args, function (data, response) {
        console.log('Online reco: started for conf %s', id);
      });
    },
    stop: function(id) {
      let args = {
        parameters: {'id': id,
                     'action': 'STOP'},
        headers: { 'Content-Type': 'application/json' }
      };

      client.get('http://' + config.host + ':' + config.port + '/stream', args, function (data, response) {
        console.log('Online reco: stop for conf %s', id);
      });
    },
    send: function(content) {
      recoStompClient.send('/app/chat', {}, JSON.stringify(content));
    },
    getOnlineReco: function(confId) {
      return new Promise((resolve, reject) => {
          let options = {
            hostname: config.host,
            port: config.port,
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
              resolve(body);
            });
          });
      });
    }
  };
};
