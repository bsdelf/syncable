import {Permission} from '../access-control';
import {
  AccessControlRuleName,
  AccessControlRuleValidator,
  GetAssociationOptions,
  Syncable,
  SyncableId,
  SyncableObject,
  SyncableRefType,
  SyncableType,
  UserSyncableObject,
} from '../syncable';

export function AccessControlRule<
  TargetSyncableObject extends SyncableObject = SyncableObject,
  Options extends object = object
>() {
  return (
    target: SyncableObject,
    name: string,
    descriptor: TypedPropertyDescriptor<
      AccessControlRuleValidator<TargetSyncableObject, Options>
    >,
  ) => {
    let validator = descriptor.value! as AccessControlRuleValidator<
      SyncableObject,
      object
    >;

    target.__accessControlRuleMap.set(name as AccessControlRuleName, {
      validator,
    });
  };
}

export abstract class Context<
  User extends UserSyncableObject = UserSyncableObject,
  OtherSyncableObject extends SyncableObject = SyncableObject
> {
  protected user!: User;

  private syncableMap = new Map<
    SyncableId,
    SyncableType<User | OtherSyncableObject>
  >();
  private syncableObjectMap = new WeakMap<
    Syncable,
    User | OtherSyncableObject
  >();

  get permissions(): Permission[] {
    return this.user.permissions;
  }

  addSyncable(syncable: SyncableType<User | OtherSyncableObject>): void {
    this.syncableMap.set(syncable.id, syncable);
  }

  get<T extends User | OtherSyncableObject>(
    ref: SyncableRefType<T>,
  ): T | undefined {
    let syncableMap = this.syncableMap;
    let syncableObjectMap = this.syncableObjectMap;

    let syncable = syncableMap.get(ref.id);

    if (!syncable) {
      return undefined;
    }

    let object = syncableObjectMap.get(syncable);

    if (!object) {
      object = this.create(syncable as SyncableType<T>);
      // TODO: object should be narrowed to non-null, TypeScript bug?
      syncableObjectMap.set(syncable, object!);
    }

    return object as T;
  }

  require<T extends User | OtherSyncableObject>(ref: SyncableRefType<T>): T {
    let object = this.get(ref);

    if (!object) {
      throw new Error(
        `SyncableObject "${JSON.stringify(ref)}" not added to context`,
      );
    }

    return object;
  }

  getRequisiteAssociations<T extends User | OtherSyncableObject>(
    options: GetAssociationOptions<T> = {},
  ): T[] {
    return this.user.getRequisiteAssociations(options) as T[];
  }

  protected abstract create<T extends User | OtherSyncableObject>(
    syncable: SyncableType<T>,
  ): T;
}
