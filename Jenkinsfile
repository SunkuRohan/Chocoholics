// CI/CD pipeline for Chocoholics.
// Needs these in Jenkins (see the runbook): agent label 'docker-agent', SonarQube server 'sonarqube',
// scanner tool 'sonar-scanner', credentials 'nexus-creds', 'swarm-ssh-key', 'chocoholics-db',
// and global environment variables NEXUS_REGISTRY, SWARM_MANAGER, NOTIFY_EMAIL.
pipeline {
  agent { label 'docker-agent' }

  options {
    skipDefaultCheckout(true)
    timestamps()
    timeout(time: 40, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
    disableConcurrentBuilds()
  }

  triggers {
    githubPush()                       // build when code is pushed (GitHub webhook)
    cron('H 2 * * 1-5')                // build periodically: about 02:00 on weekdays
    // pollSCM('H/5 * * * *')          // alternative to the webhook: poll Git every ~5 minutes
  }

  parameters {
    booleanParam(name: 'DEPLOY', defaultValue: true, description: 'Deploy to the Swarm after the image is pushed')
    choice(name: 'TRIVY_FAIL_ON', choices: ['CRITICAL', 'HIGH,CRITICAL', 'NONE'],
           description: 'Fail the build if the image scan finds these severities that have a fix available')
  }

  environment {
    IMAGE_NAME = 'chocoholics'
    STACK_NAME = 'chocoholics'
  }

  stages {
    stage('Checkout Code') {
      steps {
        cleanWs()
        checkout scm
        script {
          def sha = sh(returnStdout: true, script: 'git rev-parse --short HEAD').trim()
          env.IMAGE_TAG = "${env.BUILD_NUMBER}-${sha}"
          if (!env.NEXUS_REGISTRY || !env.SWARM_MANAGER) {
            error 'Set NEXUS_REGISTRY and SWARM_MANAGER under Manage Jenkins > System > Global properties.'
          }
          env.IMAGE = "${env.NEXUS_REGISTRY}/${env.IMAGE_NAME}:${env.IMAGE_TAG}"
        }
        echo "Building ${env.IMAGE}"
      }
    }

    stage('Build and Test') {
      steps {
        // Runs in a throwaway Node 20 container so the agent needs no Node install.
        sh '''
          docker run --rm -v "$PWD":/app -w /app --user "$(id -u):$(id -g)" -e HOME=/tmp \
            node:20-alpine sh -c "npm ci && npm run test:ci"
        '''
      }
      post {
        always { archiveArtifacts artifacts: 'coverage/lcov.info', allowEmptyArchive: true }
      }
    }

    stage('SonarQube Analysis') {
      steps {
        script {
          def scannerHome = tool 'sonar-scanner'
          withSonarQubeEnv('sonarqube') {
            sh "${scannerHome}/bin/sonar-scanner -Dsonar.projectVersion=${env.IMAGE_TAG}"
          }
        }
      }
    }

    stage('Quality Gate') {
      steps {
        // Needs the SonarQube webhook to Jenkins (see the runbook).
        timeout(time: 10, unit: 'MINUTES') {
          waitForQualityGate abortPipeline: true
        }
      }
    }

    stage('Build Image') {
      steps {
        sh 'docker build --pull -t "$IMAGE" -t "$NEXUS_REGISTRY/$IMAGE_NAME:latest" .'
      }
    }

    stage('Trivy Scan') {
      steps {
        sh '''
          mkdir -p trivy-reports
          TRIVY="docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache -v $PWD/trivy-reports:/out aquasec/trivy:latest"
          # 1) Report everything (table in the log, JSON as an artifact). Never fails the build.
          $TRIVY image --ignore-unfixed --format table "$IMAGE"
          $TRIVY image --ignore-unfixed --format json --output /out/trivy-report.json "$IMAGE"
          # 2) Gate: fail only on the severities chosen in the build parameter.
          if [ "$TRIVY_FAIL_ON" != "NONE" ]; then
            $TRIVY image --ignore-unfixed --severity "$TRIVY_FAIL_ON" --exit-code 1 --quiet "$IMAGE"
          fi
        '''
      }
      post {
        always { archiveArtifacts artifacts: 'trivy-reports/*.json', allowEmptyArchive: true }
      }
    }

    stage('Push to Nexus') {
      steps {
        withCredentials([usernamePassword(credentialsId: 'nexus-creds', usernameVariable: 'NEXUS_USR', passwordVariable: 'NEXUS_PSW')]) {
          sh '''
            echo "$NEXUS_PSW" | docker login "$NEXUS_REGISTRY" -u "$NEXUS_USR" --password-stdin
            docker push "$IMAGE"
            docker push "$NEXUS_REGISTRY/$IMAGE_NAME:latest"
            docker logout "$NEXUS_REGISTRY"
          '''
        }
      }
    }

    stage('Deploy Stack') {
      when { expression { params.DEPLOY } }
      steps {
        withCredentials([
          usernamePassword(credentialsId: 'nexus-creds', usernameVariable: 'NEXUS_USR', passwordVariable: 'NEXUS_PSW'),
          string(credentialsId: 'chocoholics-db', variable: 'DB_PSW')
        ]) {
          sshagent(credentials: ['swarm-ssh-key']) {
            sh '''
              SSH="ssh -o StrictHostKeyChecking=accept-new ec2-user@$SWARM_MANAGER"
              scp -o StrictHostKeyChecking=accept-new docker-stack.yml ec2-user@$SWARM_MANAGER:/home/ec2-user/docker-stack.yml
              # Secrets travel over stdin, never on a command line.
              echo "$NEXUS_PSW" | $SSH "docker login $NEXUS_REGISTRY -u $NEXUS_USR --password-stdin"
              printf 'IMAGE=%s\\nPOSTGRES_PASSWORD=%s\\n' "$IMAGE" "$DB_PSW" | $SSH 'umask 077; cat > /home/ec2-user/stack.env'
              $SSH 'set -a; . /home/ec2-user/stack.env; set +a; docker stack deploy --with-registry-auth -c /home/ec2-user/docker-stack.yml '"$STACK_NAME"
            '''
          }
        }
      }
    }

    stage('Verify Deployment') {
      when { expression { params.DEPLOY } }
      steps {
        sshagent(credentials: ['swarm-ssh-key']) {
          sh '''
            SSH="ssh -o StrictHostKeyChecking=accept-new ec2-user@$SWARM_MANAGER"
            for i in $(seq 1 30); do
              R=$($SSH "docker service ls --filter name=${STACK_NAME}_app --format '{{.Replicas}}'")
              echo "replicas: $R"
              [ "$R" = "3/3" ] && break
              sleep 10
            done
            [ "$R" = "3/3" ] || { $SSH "docker service ps ${STACK_NAME}_app --no-trunc"; echo "Not all replicas are running"; exit 1; }
            curl -fsS -D - -o /dev/null "http://$SWARM_MANAGER:3000/healthz" | grep -i -E 'HTTP/|x-served-by'
          '''
        }
      }
    }
  }

  post {
    success {
      emailext to: "${env.NOTIFY_EMAIL ?: ''}",
               subject: "SUCCESS: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
               body: "Build ${env.BUILD_NUMBER} passed and deployed image ${env.IMAGE}.\n${env.BUILD_URL}"
    }
    failure {
      emailext to: "${env.NOTIFY_EMAIL ?: ''}",
               subject: "FAILED: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
               body: "Build ${env.BUILD_NUMBER} failed. Open the console log:\n${env.BUILD_URL}console",
               attachLog: true
    }
    always {
      sh 'docker image prune -f || true'
      cleanWs(deleteDirs: true, notFailBuild: true)
    }
  }
}
