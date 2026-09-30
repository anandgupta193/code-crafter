import type { ContainerSpec, DockerApi, TicketContainer } from '../src/docker.ts';

export class FakeDocker implements DockerApi {
  containers: TicketContainer[] = [];
  volumes: string[] = [];
  created: ContainerSpec[] = [];
  stopped: string[] = [];
  image = true;

  async listTicketContainers() {
    return this.containers.map((c) => ({ ...c }));
  }
  async imageExists() {
    return this.image;
  }
  async createAndStart(spec: ContainerSpec) {
    this.created.push(spec);
    this.containers.push({ name: spec.name, key: spec.labels['codecrafter.key'], state: 'running', startedAt: Date.now() });
  }
  async stop(name: string) {
    this.stopped.push(name);
  }
  async remove(name: string) {
    this.containers = this.containers.filter((c) => c.name !== name);
  }
  async listVolumes(prefix: string) {
    return this.volumes.filter((v) => v.startsWith(prefix));
  }
  async removeVolume(name: string) {
    this.volumes = this.volumes.filter((v) => v !== name);
  }
}
