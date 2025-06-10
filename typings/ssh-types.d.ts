// typings/ssh-types.d.ts

declare module 'ssh2-sftp-client' {
  import { Client } from 'ssh2';
  class SftpClient {
    connect(config: any): Promise<void>;
    put(data: any, remotePath: string, options?: any): Promise<void>;
    end(): Promise<void>;
  }
  export default SftpClient;
}

declare module 'ssh2' {
  import { EventEmitter } from 'events';

  class Client extends EventEmitter {
    connect(config: any): void;
    exec(command: string, callback: (err: any, stream: NodeJS.ReadableStream) => void): void;
    end(): void;
  }

  export { Client };
}