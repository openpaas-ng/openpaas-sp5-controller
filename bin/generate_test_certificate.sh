#!/bin/sh
mkdir -p ../sslcert/
cd ../sslcert/
openssl req -newkey rsa:2048 -new -nodes -keyout key.pem -out csr.pem
openssl x509 -req -days 365 -in csr.pem -signkey key.pem -out server.crt
