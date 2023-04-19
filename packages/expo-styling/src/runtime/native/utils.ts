import React from "react";

function useDynamicDependancies(value: React.DependencyList) {
  const ref = React.useRef<React.DependencyList>([]);

  if (
    value.length !== ref.current.length ||
    !ref.current.every((v, i) => Object.is(v, value[i]))
  ) {
    ref.current = value;
  }

  return ref.current;
}

export function useDynamicMemo<T>(
  factory: () => T,
  value: React.DependencyList
) {
  return React.useMemo(factory, [useDynamicDependancies(value)]);
}
