'use strict';

const http = require('http');
const Stomp = require('stompjs');
const Sock = require('sockjs-client');
const Client = require('node-rest-client').Client;
const client = new Client();

module.exports = function(config) {
  let recoStompClient;

  let connected = false;

  function tryConnect() {
    recoStompClient = Stomp.over(new Sock('http://'+ config.host+ ':' + config.port + '/chat'));
    recoStompClient.connect(
      {},
      (success) => {
        connected = true;
        console.log('Online reco: STOMP connected to %s:%s', config.host, config.port);
      },
      (err) => {
        connected = false;

        console.error('Online reco: STOMP failed to connect to %s:%s (trying again in %d ms)',
                      config.host, config.port, config.reconnectInterval);
        console.error('Online reco: %j', err.stack || err.toString());
        setTimeout(tryConnect, config.reconnectInterval);
      });
  }

  tryConnect();

  return {
    start: function(id) {
      let args = {
        parameters: {'id': id,
                     'action': 'START'},
        headers: { 'Content-Type': 'application/json' }
      };

      let req = client.get('http://' + config.host + ':' + config.port + '/stream', args, function (data, response) {
        console.log('Online reco: started for conf %s', id);
      });

      req.on('error', (err) => {
        console.error('Online reco: error trying to reach http://%s:%s.stream',
                      config.host,
                      config.port);
      });
    },
    stop: function(id) {
      let args = {
        parameters: {'id': id,
                     'action': 'STOP'},
        headers: { 'Content-Type': 'application/json' }
      };

      let req = client.get('http://' + config.host + ':' + config.port + '/stream', args, function (data, response) {
        console.log('Online reco: stop for conf %s', id);
      });

      req.on('error', (err) => {
        console.error('Online reco: error trying to reach http://%s:%s/stream',
                      config.host,
                      config.port);
      });
    },
    send: function(content) {
      if(connected) {
        recoStompClient.send('/app/chat', {}, JSON.stringify(content));
      } else {
        console.error('Online reco: not connected but trying to send %j', content);
      }
    },
    getOnlineReco: function(confId) {
      return new Promise((resolve, reject) => {
        let options = {
          hostname: config.host,
          port: config.port,
          path: '/resources?id=' + confId + '&resources=keywords;wiki',
          method: 'GET',
          headers: {
            'Content-type': 'application/json'
          }
        };

        http.get(options, function(response){
          var body = '';
          response.on('data', function(d) {
            body += d;
          });
          response.on('end', () =>{
            resolve(body);
          });

        }).on('error', (e) => {
          console.error('Online reco: error trying to reach http://%s:%s/resources',
                        config.host,
                        config.port);
          reject('Online reco: error trying to reach http://' +
                 config.host + ':' + config.port + '/resources');
        });

      });
    }
  };
};
