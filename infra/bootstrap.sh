#!/usr/bin/env bash
# One script for every instance role. Run as root (EC2 user data does this automatically).
# Usage: bash infra/bootstrap.sh <jenkins-controller|jenkins-agent|sonarqube|nexus|swarm-node>
set -euxo pipefail
ROLE="${1:?role required: jenkins-controller | jenkins-agent | sonarqube | nexus | swarm-node}"
exec > >(tee -a /var/log/bootstrap.log) 2>&1
echo "== bootstrap role=$ROLE $(date)"

install_docker() {
  dnf install -y docker git
  systemctl enable --now docker
}

case "$ROLE" in
  jenkins-controller)
    dnf install -y fontconfig java-17-amazon-corretto-devel git
    curl -fsSL https://pkg.jenkins.io/redhat-stable/jenkins.repo -o /etc/yum.repos.d/jenkins.repo
    rpm --import https://pkg.jenkins.io/redhat-stable/jenkins.io-2023.key || echo "Key import failed: check the current key name at jenkins.io/doc/book/installing/linux"
    dnf install -y jenkins
    systemctl enable --now jenkins
    echo "Initial admin password: /var/lib/jenkins/secrets/initialAdminPassword"
    ;;
  jenkins-agent)
    install_docker
    dnf install -y java-17-amazon-corretto-devel jq
    id jenkins >/dev/null 2>&1 || useradd -m -s /bin/bash jenkins
    usermod -aG docker jenkins
    install -d -m 700 -o jenkins -g jenkins /home/jenkins/.ssh
    install -d -o jenkins -g jenkins /home/jenkins/agent
    echo "Agent ready. Add the controller's public key to /home/jenkins/.ssh/authorized_keys"
    ;;
  sonarqube)
    install_docker
    sysctl -w vm.max_map_count=524288 fs.file-max=131072
    printf 'vm.max_map_count=524288\nfs.file-max=131072\n' > /etc/sysctl.d/99-sonarqube.conf
    docker network create sonarnet || true
    docker volume create sonar_pg >/dev/null
    docker run -d --name sonar-db --restart unless-stopped --network sonarnet \
      -e POSTGRES_USER=sonar -e POSTGRES_PASSWORD=sonar -e POSTGRES_DB=sonar \
      -v sonar_pg:/var/lib/postgresql/data postgres:16-alpine
    sleep 10
    docker run -d --name sonarqube --restart unless-stopped --network sonarnet -p 9000:9000 \
      --ulimit nofile=131072:131072 --ulimit nproc=8192:8192 \
      -e SONAR_JDBC_URL=jdbc:postgresql://sonar-db:5432/sonar -e SONAR_JDBC_USERNAME=sonar -e SONAR_JDBC_PASSWORD=sonar \
      -v sonar_data:/opt/sonarqube/data -v sonar_logs:/opt/sonarqube/logs -v sonar_ext:/opt/sonarqube/extensions \
      sonarqube:community
    echo "SonarQube takes a few minutes to start: http://<this-instance>:9000 (admin / admin, then change it)"
    ;;
  nexus)
    install_docker
    install -d -o 200 -g 200 /opt/nexus-data
    docker run -d --name nexus --restart unless-stopped -p 8081:8081 -p 8083:8083 \
      -e INSTALL4J_ADD_VM_PARAMS="-Xms1536m -Xmx1536m -XX:MaxDirectMemorySize=1536m" \
      -v /opt/nexus-data:/nexus-data sonatype/nexus3
    echo "Nexus takes a few minutes to start. Admin password: docker exec nexus cat /nexus-data/admin.password"
    ;;
  swarm-node)
    install_docker
    usermod -aG docker ec2-user
    echo "Docker ready. Next: docker swarm init (manager) or docker swarm join (workers)"
    ;;
  *) echo "Unknown role: $ROLE"; exit 1 ;;
esac
echo "== bootstrap finished for $ROLE"
