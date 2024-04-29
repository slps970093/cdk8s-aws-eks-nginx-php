FROM nginx:1.25.5

COPY ./docker/nginx/start.sh /
COPY ./docker/nginx/supervisord.conf /

RUN apt-get update -y &&\
    apt-get install wget gnupg2 -y

# filebeat
RUN wget -qO - https://artifacts.elastic.co/GPG-KEY-elasticsearch | apt-key add - &&\
    echo "deb https://artifacts.elastic.co/packages/8.x/apt stable main" | tee -a /etc/apt/sources.list.d/elastic-8.x.list &&\
    apt-get update -y
# supervisor filebeat
RUN apt-get install -y -f vim curl apt-transport-https filebeat  &&\
    apt-get install supervisor python3 python3-pip git pipx -y &&\
    chmod a+x start.sh &&\
    pipx ensurepath &&\
    pip install git+https://github.com/coderanger/supervisor-stdout --break-system-packages &&\
    apt-get clean &&\
    apt-get autoremove &&\
    rm -rf /var/lib/apt/lists/* &&\
    rm -rf /tmp/pear

CMD ["/start.sh"]
