# OpenPaaS Sp5 Controller

This is the repository for the SP5 controller of the OpenPaaS project

## Install

run `npm install`

Generate a valid ssl key pair and store it into the sslcert folder or change the path to the key pair in `config.json` (see the Configure section).

For testing purpose a convenience script is provided to generate an ssl key pair (require openssl):
- go the the `bin` folder
- run `./generate_test_certificate.sh`
- fill the required fields

## Configure

All configuration is done in the `config.json` file.

Some especially important configuration options are
- `port` to set the port on which the server is running
- `summaryAPI.{host,port}` to set the host of the keywords/recommandation/summary engine
- `speechProcessing.kaldi.gstreamerURL` when using a the kaldi backend (default) to set the host of the kaldi-gstreamer server

## Run

run `npm start`
