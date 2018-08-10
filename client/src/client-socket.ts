import {
  ChangePacket,
  ConsequentSeries,
  SnapshotEventData,
  UserSyncableObject,
} from '@syncable/core';
import io = require('socket.io-client');

export interface ClientSocket<TUser extends UserSyncableObject>
  extends SocketIOClient.Socket {
  on(event: 'reconnect', listener: (attempt: number) => void): this;

  on(
    event: 'consequent-series',
    listener: (series: ConsequentSeries) => void,
  ): this;

  on(
    event: 'snapshot',
    listener: (snapshot: SnapshotEventData<TUser>) => void,
  ): this;

  emit(event: 'change', packet: ChangePacket): this;

  emit(event: 'request', request: Request): this;
}

export function createClientSocket<TUser extends UserSyncableObject>(
  uri: string,
): ClientSocket<TUser> {
  return io(uri, {transports: ['websocket']}) as ClientSocket<TUser>;
}
