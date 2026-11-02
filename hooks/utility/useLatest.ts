import { useRef } from 'react';
import type { RefObject } from 'react';

const useLatest = <T>(value: T): RefObject<T> => {
  const latestRef = useRef<T>(value);
  latestRef.current = value;
  return latestRef;
};

export default useLatest;
