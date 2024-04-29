## CDK8S Nginx + PHP-FPM

這份 repo 整合了 機密管理+nginx+php-fpm+hpa的相關設定，大幅簡化開發開發者撰寫K8S YML 的麻煩

## EKS 前置作業
1. 安裝 <a href="https://external-secrets.io/latest/">external-secrets</a>
2. 安裝 <a href="https://kubernetes-sigs.github.io/aws-load-balancer-controller/">AWS ALB Controller</a>

## Jenkins Pipeline 

```
pipeline {
    agent none
    stages {
        stage('Build') {
            agent {
                docker { image 'chialab/php-dev:8.2-apache' }
            }
            steps {
                git branch: '<<BRANCH>>', credentialsId: '<<憑證編號>>', url: '<<GIT REPO>>'
                sh 'composer install'
            }
        }
        stage('Push ECR - NGINX') {
            agent any
            environment {
                AWS_REGION="ap-northeast-1"
                ECR_REPOSITORY_URL="***"
                ECR_REPOSITORY_NAME=""
            }
            steps {
                sh 'docker system prune -f'
                sh 'aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REPOSITORY_URL}'
                sh 'docker build --no-cache -f ./cdk8s/docker/nginx/Dockerfile -t ${ECR_REPOSITORY_URL}/${ECR_REPOSITORY_NAME}:latest $PWD'
                sh 'docker tag ${ECR_REPOSITORY_URL}/${ECR_REPOSITORY_NAME}:latest ${ECR_REPOSITORY_URL}/${ECR_REPOSITORY_NAME}:nginx-${BUILD_NUMBER}'
                sh 'docker push ${ECR_REPOSITORY_URL}/${ECR_REPOSITORY_NAME}:nginx-${BUILD_NUMBER}' 
            }
        }
        stage('Push ECR - PHP-FPM') {
            agent any
            environment {
                EKS_CLUSTER_NAME="***"
                AWS_REGION="ap-northeast-1"
                ECR_REPOSITORY_URL="***"
                ECR_REPOSITORY_NAME=""
            }
            steps {
                sh 'docker system prune -f'
                sh 'aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REPOSITORY_URL}'
                sh 'docker build --no-cache -f ./cdk8s/docker/php-fpm/Dockerfile -t ${ECR_REPOSITORY_URL}/${ECR_REPOSITORY_NAME}:latest $PWD'
                sh 'docker tag ${ECR_REPOSITORY_URL}/${ECR_REPOSITORY_NAME}:latest ${ECR_REPOSITORY_URL}/${ECR_REPOSITORY_NAME}:php-fpm-${BUILD_NUMBER}'
                sh 'docker push ${ECR_REPOSITORY_URL}/${ECR_REPOSITORY_NAME}:php-fpm-${BUILD_NUMBER}'        
            }
        }
        stage('generate yml') {
            agent {
                docker { 
                    image 'node:18-alpine'
                    args '-u root'
                }
            }
            environment {
                K8S_NAMESPACE=""
                AWS_REGION=""
                AWS_SECRET_MANAGER_NAME=""
                AWS_CERTIFICATE_ARN=""
                AWS_ALB_NAME_PREFIX=""
                NGINX_DOCKER_IMAGE_URL=""
                PHP_FPM_DOCKER_IMAGE_URL=""
                SERVICE_ACCOUNT=""
            }
            steps {
                script {
                    try {
                        sh 'cd cdk8s && npm install && npm run synth'
                    } catch (Exception e) {
                        // 處理錯誤，如打印錯誤資訊
                        echo "Error: ${e.getMessage()}"
                        // 強制設置退出狀態碼為零
                        sh 'exit 0'
                    }
                }
                sh "sed 's/<<NAMESPACE>>/${K8S_NAMESPACE}/g; s/<<AWS_REGION>>/${AWS_REGION}/g; s/<<AWS_SECRET_MANAGER_NAME>>/${AWS_SECRET_MANAGER_NAME}/g; s/<<AWS_CERTIFICATE_ARN>>/${AWS_CERTIFICATE_ARN}/g; s/<<AWS_ALB_NAME_PREFIX>>/${AWS_ALB_NAME_PREFIX}/g; s/<<NGINX_DOCKER_IMAGE_URL>>/${NGINX_DOCKER_IMAGE_URL}/g; s/<<PHP_FPM_DOCKER_IMAGE_URL>>/${PHP_FPM_DOCKER_IMAGE_URL}/g; s/<<SERVICE_ACCOUNT>>/${SERVICE_ACCOUNT}/g; s/<<AWS_CERTIFICATE_ARN>>/${AWS_CERTIFICATE_ARN}/g;' ./cdk8s/dist/cdk8s.k8s.yaml > ./cdk8s/dist/eks.yml"
                sh "cat ./cdk8s/dist/eks.yml"
            }
        }
        stage('Deploy EKS') {
            agent any
            environment {
                EKS_CLUSTER_NAME="***"
                AWS_REGION="ap-northeast-1"
            }
            steps {
                sh 'aws eks update-kubeconfig --name ${EKS_CLUSTER_NAME} --region ${AWS_REGION} --kubeconfig $HOME/.kube/****'
                sh 'kubectl apply -f ./cdk8s/dist/eks.yaml --kubeconfig=$HOME/.kube/****'
            }
        }
    }
}
```

## FPM 健康檢查

使用這個 <a href="https://github.com/renatomefi/php-fpm-healthcheck/tree/master?tab=readme-ov-file#installation">REPO</a>
