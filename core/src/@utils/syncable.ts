import {SyncableObject, SyncableRef} from '../syncable';

export function getRef<T extends SyncableObject>({
  $id,
  $type,
}: T['syncable']): SyncableRef<T> {
  return {id: $id, type: $type};
}
