import {
  AbstractSyncableObject,
  AbstractSyncableObjectFactory,
  AbstractUserSyncableObject,
  BuiltInChange,
  ChangePacket,
  ChangePacketUID,
  ChangePlant,
  Context,
  GeneralChange,
  GeneralSyncableRef,
  IChange,
  ISyncable,
  InitialData,
  SnapshotData,
  SyncableId,
  SyncableManager,
  SyncableRef,
  SyncingData,
} from '@syncable/core';
import * as DeepDiff from 'deep-diff';
import _ from 'lodash';
import uuid from 'uuid';

import {ClientSocket} from './@client-socket';

export interface ClientAssociateOptions {
  name?: string;
  requisite?: boolean;
  secures?: boolean;
}

export interface ClientGenericParams {
  user: AbstractUserSyncableObject;
  syncableObject: AbstractSyncableObject;
  change: IChange;
}

export class Client<
  TGenericParams extends ClientGenericParams = ClientGenericParams
> {
  readonly context: Context<TGenericParams['user']>;
  readonly ready: Promise<void>;

  private manager: SyncableManager;
  private socket: ClientSocket<TGenericParams['user']>;

  private pendingChangePackets: ChangePacket[] = [];
  private syncableSnapshotMap = new Map<SyncableId, ISyncable>();

  constructor(
    socket: SocketIOClient.Socket,
    factory: AbstractSyncableObjectFactory,
    changePlant: ChangePlant<TGenericParams['user'], TGenericParams['change']>,
  );
  constructor(
    socket: SocketIOClient.Socket,
    factory: AbstractSyncableObjectFactory,
    private changePlant: ChangePlant,
  ) {
    this.context = new Context('user');
    this.manager = new SyncableManager(factory);

    this.socket = socket as ClientSocket<TGenericParams['user']>;

    this.ready = new Promise<void>(resolve => {
      this.socket.on('syncable:initialize', data => {
        this.manager.clear();
        this.onInitialize(data);
        resolve();
      });
    });

    this.socket.on('syncable:sync', data => {
      this.onSync(data);
    });
  }

  get user(): TGenericParams['user'] {
    return this.context.user;
  }

  getObjects(): TGenericParams['syncableObject'][];
  getObjects<T extends TGenericParams['syncableObject']>(
    type: T['syncable']['_type'],
  ): T[];
  getObjects(type?: string): TGenericParams['syncableObject'][] {
    return this.manager.getSyncableObjects(
      type,
    ) as TGenericParams['syncableObject'][];
  }

  getObject<T extends TGenericParams['syncableObject']>(
    ref: SyncableRef<T>,
  ): T | undefined {
    return this.manager.getSyncableObject(ref) as T;
  }

  requireObject<T extends TGenericParams['syncableObject']>(
    ref: SyncableRef<T>,
  ): T {
    return this.manager.requireSyncableObject(ref) as T;
  }

  associate(
    target: TGenericParams['syncableObject'],
    source: TGenericParams['syncableObject'],
    options?: ClientAssociateOptions,
  ): void;
  associate(
    {ref: target}: TGenericParams['syncableObject'],
    {ref: source}: TGenericParams['syncableObject'],
    {name, secures = false, requisite = secures}: ClientAssociateOptions = {},
  ): void {
    this.update({
      type: '$associate',
      refs: {target, source},
      options: {name, requisite, secures},
    });
  }

  unassociate(
    target: TGenericParams['syncableObject'],
    source: TGenericParams['syncableObject'],
  ): void;
  unassociate(
    {ref: target}: TGenericParams['syncableObject'],
    {ref: source}: TGenericParams['syncableObject'],
  ): void {
    this.update({
      type: '$unassociate',
      refs: {target, source},
      options: {},
    });
  }

  update(change: TGenericParams['change'] | BuiltInChange): void {
    let packet: ChangePacket = {
      uid: uuid() as ChangePacketUID,
      ...(change as GeneralChange),
    };

    this.applyChangePacket(packet);
    this.pushChangePacket(packet);
  }

  private onInitialize({
    userRef,
    ...data
  }: InitialData<TGenericParams['user']>): void {
    this.onSnapshotData(data, false);

    let user = this.manager.requireSyncableObject(userRef);
    this.context.initialize(user);
  }

  private onSync(data: SyncingData): void {
    if ('source' in data) {
      let matched = this.shiftChangePacket(data.source.uid);

      this.onSnapshotData(data, matched);

      for (let {ref, diffs} of data.updates) {
        this.onUpdateChange(ref, diffs);
      }

      for (let packet of this.pendingChangePackets) {
        this.applyChangePacket(packet);
      }
    } else {
      this.onSnapshotData(data, false);
    }
  }

  private onSnapshotData(
    {syncables, removals}: SnapshotData,
    update: boolean,
  ): void {
    for (let syncable of syncables) {
      this.onUpdateCreate(syncable, update);
    }

    for (let ref of removals) {
      this.onUpdateRemove(ref);
    }
  }

  private onUpdateCreate(syncable: ISyncable, update: boolean): void {
    this.manager.addSyncable(syncable, update);

    let snapshot = _.cloneDeep(syncable);

    this.syncableSnapshotMap.set(syncable._id, snapshot);
  }

  private onUpdateRemove(ref: SyncableRef): void {
    this.manager.removeSyncable(ref);
    this.syncableSnapshotMap.delete(ref.id);
  }

  private onUpdateChange(ref: SyncableRef, diffs: deepDiff.IDiff[]): void {
    let snapshot = this.syncableSnapshotMap.get(ref.id)!;

    for (let diff of diffs) {
      DeepDiff.applyChange(snapshot, undefined!, diff);
    }

    this.manager.updateSyncable(snapshot);
  }

  private shiftChangePacket(uid: ChangePacketUID): boolean {
    let packets = this.pendingChangePackets;

    let index = packets.findIndex(packet => packet.uid === uid);

    if (index < 0) {
      return false;
    }

    if (index === 0) {
      packets.shift();
      return true;
    }

    throw new Error(
      `Change packet UID "${uid}" does not match the first pending packet`,
    );
  }

  private applyChangePacket(packet: ChangePacket): void {
    let manager = this.manager;

    let refDict = packet.refs;

    let syncableObjectOrCreationRefDict = _.mapValues(
      refDict,
      (ref: GeneralSyncableRef) =>
        'creation' in ref && ref.creation
          ? ref
          : manager.requireSyncableObject(ref),
    );

    let {updates: updateDict, creations, removals} = this.changePlant.process(
      packet,
      syncableObjectOrCreationRefDict,
      this.context,
    );

    for (let {snapshot} of Object.values(updateDict)) {
      manager.updateSyncable(snapshot);
    }

    for (let ref of removals) {
      manager.removeSyncable(ref);
    }

    for (let syncable of creations) {
      manager.addSyncable(syncable);
    }
  }

  private pushChangePacket(packet: ChangePacket): void {
    this.pendingChangePackets.push(packet);

    this.socket.emit('syncable:change', packet);
  }
}
