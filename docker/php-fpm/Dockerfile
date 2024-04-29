FROM php:8.2-fpm
# 參考
# https://learnku.com/articles/31344
COPY ./ /var/www/html

RUN apt-get update -y &&\
    apt-get install wget gnupg2 -y

# filebeat
RUN wget -qO - https://artifacts.elastic.co/GPG-KEY-elasticsearch | apt-key add - &&\
    echo "deb https://artifacts.elastic.co/packages/8.x/apt stable main" | tee -a /etc/apt/sources.list.d/elastic-8.x.list &&\
    apt-get update -y &&\
    apt-get install -y -f vim curl apt-transport-https filebeat

# GD EXT
RUN apt-get install -y --no-install-recommends libfreetype6-dev libjpeg62-turbo-dev libpng-dev \
    && docker-php-ext-configure gd  \
    && docker-php-ext-install -j$(nproc) gd

RUN docker-php-ext-install -j$(nproc) bcmath calendar exif gettext sockets dba mysqli pcntl pdo_mysql shmop sysvmsg sysvsem sysvshm iconv

# supervisor
RUN apt-get install supervisor python3 python3-pip git pipx -y &&\
    pipx ensurepath &&\
    pip install git+https://github.com/coderanger/supervisor-stdout --break-system-packages

# php fpm healthcheck
RUN apt-get install -y --no-install-recommends libfcgi-bin &&\
    wget -O /usr/local/bin/php-fpm-healthcheck \
    https://raw.githubusercontent.com/renatomefi/php-fpm-healthcheck/master/php-fpm-healthcheck \
    && chmod +x /usr/local/bin/php-fpm-healthcheck

# redis EXT
RUN pecl install redis && docker-php-ext-enable redis

# clear and setting
RUN chmod a+x /var/www/html/docker/php-fpm/start.sh &&\
    apt-get clean &&\
    apt-get autoremove &&\
    rm -rf /var/lib/apt/lists/* &&\
    rm -rf /tmp/pear

ENV FCGI_CONNECT=127.0.0.1:9000
ENV FCGI_STATUS_PATH=/fpm-status

CMD ["/var/www/html/cdk8s/docker/php-fpm/start.sh"]
