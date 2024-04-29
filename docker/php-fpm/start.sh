#!/bin/bash

chown -Rf www-data:www-data /var/www/html/storage
chown -Rf www-data:www-data /var/www/html/bootstrap
chown -Rf www-data:www-data /var/www/html/public

mkdir /var/log/php
chmod 666 /var/log/php

supervisord -n -c /var/www/html/cdk8s/docker/php-fpm/supervisord.conf
