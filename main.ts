import { Construct } from 'constructs';
import {ApiObject, App, Chart, ChartProps} from 'cdk8s';
import {
    IntOrString,
    KubeConfigMap,
    KubeDeployment,
    KubeHorizontalPodAutoscalerV2,
    KubeIngress,
    KubeService
} from "./imports/k8s";
import {readFileSync} from "fs";
import {ServiceType} from "cdk8s-plus-25";

export class MyChart extends Chart {
  constructor(scope: Construct, id: string, props: ChartProps = { }) {
    super(scope, id, props);

    // define resources here

      const nginxCfg = {
          label: {
              app: `nginx-${id}`
          },
          namespace: "<<NAMESPACE>>",
          serviceName: "nginx-serv",
          replicas: {
              min: 1,
              max: 50
          }
      }

      const phpFpmCfg = {
          label: {
              app: `php-fpm-${id}`
          },
          namespace: "<<NAMESPACE>>",
          serviceName: "php-fpm-serv",
          replicas: {
              min: 1,
              max: 50
          }
      }

      const cfgMapNginx = new KubeConfigMap(this,'nginx-configmap', {
          metadata: {
              namespace: nginxCfg.namespace,
              name: "nginx-configmap"
          },
          data: {
              "default.conf": readFileSync('./docker/nginx/config/default.conf')
                .toString()
                .replace("{{PHPFPM_LOCATION}}", `${phpFpmCfg.serviceName}.${phpFpmCfg.namespace}.svc.cluster.local:9000`),
              "nginx.conf": readFileSync('./docker/nginx/config/nginx.conf')
                .toString()
          }
      })

      // https://serverfault.com/questions/884256/how-and-where-to-configure-pm-max-children-for-php-fpm-with-docker
      const cfgMapPhpFpm = new KubeConfigMap(this,"php-fpm-configmap", {
          metadata: {
              namespace: phpFpmCfg.namespace,
              name: "php-fpm-configmap"
          },
          data: {
              "www.conf": readFileSync('./docker/php-fpm/config/php-fpm.d/www.conf').toString(),
              "docker.conf": readFileSync('./docker/php-fpm/config/php-fpm.d/docker.conf').toString(),
          }
      })

      const secretName = "laravel-secrets";

      const secretStore = new ApiObject(this, 'secret-store', {
          apiVersion: 'external-secrets.io/v1beta1',
          kind: 'SecretStore',
          metadata: {
              namespace: phpFpmCfg.namespace,
              name: "cdk8s-laravel-secret-store"
          },
          spec: {
              provider: {
                  aws: {
                      service: "SecretsManager",
                      region: "<<AWS_REGION>>",
                  }
              }
          }
      });

      new ApiObject(this, "external-secret", {
          apiVersion: 'external-secrets.io/v1beta1',
          kind: 'ExternalSecret',
          metadata: {
              namespace: phpFpmCfg.namespace,
              name: 'cdk8s-laravel-external-secret'
          },
          spec: {
              refreshInterval: "5m",
              secretStoreRef: {
                  name: secretStore.metadata.name,
                  kind: secretStore.kind
              },
              target: {
                  name: secretName,
                  creationPolicy: "Owner"
              },
              dataFrom: [
                  {
                      extract: {
                          key: "<<AWS_SECRET_MANAGER_NAME>>"
                      }
                  }
              ]
          }
      })

      // deploy
      const deployNginx = new KubeDeployment(this, "nginx-deploy", {
          metadata: {
              namespace: nginxCfg.namespace
          },
          spec: {
              selector: { matchLabels: nginxCfg.label },
              template: {
                  metadata: { labels: nginxCfg.label },
                  spec: {
                      containers: [
                          {
                              name: "nginx",
                              image: "<<NGINX_DOCKER_IMAGE_URL>>",
                              ports: [ { containerPort: 80 } ],
                              volumeMounts: [
                                  {
                                      name: "nginx-site",
                                      mountPath: "/etc/nginx/conf.d/default.conf",
                                      subPath: "default.conf"
                                  },
                                  {
                                      name: "nginx-cfg",
                                      mountPath: "/etc/nginx/nginx.conf",
                                      subPath: "nginx.conf"
                                  }
                              ],
                              // 服務健康檢查 - 就緒檢查
                              readinessProbe: {
                                  successThreshold: 1,
                                  failureThreshold: 3,
                                  periodSeconds: 5,
                                  timeoutSeconds: 2,
                                  httpGet: {
                                      port: IntOrString.fromNumber(80),
                                      path: "/nginx_status"
                                  }
                              },
                              // 服務健康檢查 - 存活檢查
                              livenessProbe: {
                                  initialDelaySeconds: 0,
                                  periodSeconds: 10,
                                  httpGet: {
                                      port: IntOrString.fromNumber(80),
                                      path: "/nginx_status"
                                  }
                              }
                          },
                      ],
                      volumes: [
                          {
                              name: "nginx-site",
                              configMap: {
                                  name: cfgMapNginx.name,
                                  items: [
                                      {
                                          key: "default.conf",
                                          path: "default.conf"
                                      }
                                  ]
                              }
                          },
                          {
                              name: "nginx-cfg",
                              configMap: {
                                  name: cfgMapNginx.name,
                                  items: [
                                      {
                                          key: "nginx.conf",
                                          path: "nginx.conf"
                                      }
                                  ]
                              }
                          }
                      ]
                  }
              }
          }
      })

      const deployPhpFpm = new KubeDeployment(this,"php-fpm-deploy", {
          metadata: {
              namespace: phpFpmCfg.namespace
          },
          spec: {
              selector: { matchLabels: phpFpmCfg.label },
              template: {
                  metadata: { labels: phpFpmCfg.label },
                  spec: {
                      // serviceAccount: "<<SERVICE_ACCOUNT>>",
                      containers: [
                          {
                              name: "php-fpm",
                              image: "<<PHP_FPM_DOCKER_IMAGE_URL>>",
                              securityContext: {
                                  capabilities: {
                                      add: ["SYS_PTRACE"]
                                  }
                              },
                              envFrom: [
                                  {
                                      secretRef: {
                                          name: secretName
                                      }
                                  }
                              ],
                              volumeMounts: [
                                  {
                                      name: "fpm-config",
                                      mountPath: "/usr/local/etc/php-fpm.d/www.conf",
                                      subPath: "www.conf"
                                  },
                                  {
                                    name: "fpm-config-docker",
                                    mountPath: "/usr/local/etc/php-fpm.d/docker.conf",
                                    subPath: "docker.conf"
                                }
                              ],
                              ports: [ { containerPort: 9000 } ],
                              // 服務健康檢查 - 就緒檢查
                              readinessProbe: {
                                  successThreshold: 1,
                                  failureThreshold: 3,
                                  periodSeconds: 5,
                                  timeoutSeconds: 2,
                                  exec: {
                                      command: ["php-fpm-healthcheck"]
                                  }
                              },
                              // 服務健康檢查 - 存活檢查
                              livenessProbe: {
                                  initialDelaySeconds: 0,
                                  periodSeconds: 10,
                                  exec: {
                                      command: ["php-fpm-healthcheck", "--listen-queue=10"]
                                  }
                              }
                          }
                      ],
                      volumes: [
                          {
                              name: "fpm-config",
                              configMap: {
                                  name: cfgMapPhpFpm.name,
                                  items: [
                                      {
                                          key: "www.conf",
                                          path: "www.conf"
                                      }
                                  ]
                              }
                          },
                          {
                            name: "fpm-config-docker",
                            configMap: {
                                name: cfgMapPhpFpm.name,
                                items: [
                                    {
                                        key: "docker.conf",
                                        path: "docker.conf"
                                    }
                                ]
                            }
                        }
                      ]
                  }
              }
          }
      })

      // service
      const servNginx = new KubeService(this, 'nginx-serv', {
          metadata: {
              namespace: nginxCfg.namespace,
              name: nginxCfg.serviceName
          },
          spec: {
              type: ServiceType.NODE_PORT,
              ports: [
                  {
                      name: "http-port",
                      port: 80,
                      targetPort: IntOrString.fromNumber(80),
                      protocol: "TCP"
                  }
              ],
              selector: nginxCfg.label
          }
      })

      new KubeService(this, 'php-fpm-serv', {
          metadata: {
              namespace: phpFpmCfg.namespace,
              name: phpFpmCfg.serviceName
          },
          spec: {
              type: ServiceType.CLUSTER_IP,
              ports: [
                  {
                      name: "fpm-port",
                      port: 9000,
                      targetPort: IntOrString.fromNumber(9000),
                      protocol: "TCP"
                  }
              ],
              selector: phpFpmCfg.label
          }
      });

      // HPA
      new KubeHorizontalPodAutoscalerV2(this, "nginx-hpa", {
          metadata: {
              namespace: nginxCfg.namespace,
              name: "nginx-hpa"
          },
          spec: {
              scaleTargetRef: {
                  apiVersion: deployNginx.apiVersion,
                  kind: deployNginx.kind,
                  name: deployNginx.name
              },
              metrics: [
                  {
                      resource: {
                          name: "CPU",
                          target: {
                              averageUtilization: 50,
                              type: "Utilization"
                          }
                      },
                      type: "Resource"
                  }
              ],
              minReplicas: nginxCfg.replicas.min,
              maxReplicas: nginxCfg.replicas.max,
              behavior: {
                  scaleUp: {
                      stabilizationWindowSeconds: 10,
                      policies: [
                          {
                              type: "Percent",
                              value: 100,
                              periodSeconds: 15
                          },
                          {
                              type: "Pods",
                              value: 4,
                              periodSeconds: 15
                          }
                      ]
                  },
                  scaleDown: {
                      stabilizationWindowSeconds: 300,
                      policies: [
                          {
                              type: "Pods",
                              value: 1,
                              periodSeconds: 300
                          }
                      ]
                  }
              }
          }
      });

      new KubeHorizontalPodAutoscalerV2(this, "php-fpm-hpa", {
          metadata: {
              namespace: phpFpmCfg.namespace,
              name: "php-fpm-hpa"
          },
          spec: {
              scaleTargetRef: {
                  apiVersion: deployPhpFpm.apiVersion,
                  kind: deployPhpFpm.kind,
                  name: deployPhpFpm.name
              },
              metrics: [
                  {
                      resource: {
                          name: "CPU",
                          target: {
                              averageUtilization: 50,
                              type: "Utilization"
                          }
                      },
                      type: "Resource"
                  }
              ],
              minReplicas: phpFpmCfg.replicas.min,
              maxReplicas: phpFpmCfg.replicas.max,
              behavior: {
                  scaleUp: {
                      stabilizationWindowSeconds: 10,
                      policies: [
                          {
                              type: "Percent",
                              value: 100,
                              periodSeconds: 15
                          },
                          {
                              type: "Pods",
                              value: 4,
                              periodSeconds: 15
                          }
                      ]
                  },
                  scaleDown: {
                      stabilizationWindowSeconds: 300,
                      policies: [
                          {
                              type: "Pods",
                              value: 1,
                              periodSeconds: 300
                          }
                      ]
                  }
              }
          }
      });

      // Ingress
      new KubeIngress(this, "nginx-ingress", {
          metadata: {
              namespace: nginxCfg.namespace,
              annotations: {
                  "alb.ingress.kubernetes.io/load-balancer-name": "<<AWS_ALB_NAME_PREFIX>>-alb",
                  "alb.ingress.kubernetes.io/scheme": "internet-facing",
                  "alb.ingress.kubernetes.io/group.name": "<<AWS_ALB_NAME_PREFIX>>-tg",
                  "alb.ingress.kubernetes.io/target-type": "ip",
                  "alb.ingress.kubernetes.io/certificate-arn": "<<AWS_CERTIFICATE_ARN>>",
                  "alb.ingress.kubernetes.io/listen-ports": '[{"HTTP": 80}, {"HTTPS":443}]',
                  "alb.ingress.kubernetes.io/ssl-redirect": "443",
                  // 缩小延迟注销时间
                  "alb.ingress.kubernetes.io/target-group-attributes": "deregistration_delay.timeout_seconds=30"
              },
          },
          spec: {
              ingressClassName: "alb",
              rules: [
                  {
                      http: {
                          paths: [
                              {
                                  path: "/",
                                  pathType: "Prefix",
                                  backend: {
                                      service: {
                                          name: servNginx.name,
                                          port: {
                                              number: 80
                                          }
                                      }
                                  }
                              }
                          ]
                      }
                  }
              ]
          }
      });
  }
}

const app = new App();
new MyChart(app, 'cdk8s');
app.synth();
