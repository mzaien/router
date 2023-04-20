import React, { ComponentType, FunctionComponent } from "react";
import { View, ViewProps } from "react-native";

import { cssToReactNativeRuntime } from "../css-to-rn";
import { defaultCSSInterop } from "../runtime/native/css-interop";
import { StyleSheet } from "../runtime/native/stylesheet";

export function registerCSS(css: string) {
  StyleSheet.register(cssToReactNativeRuntime(Buffer.from(css)));
}

type MockComponentProps = ViewProps & { className?: string };

export function createMockComponent(
  Component: React.ComponentType = View
): FunctionComponent<MockComponentProps> {
  const component = jest.fn((props) => <Component {...props} />);

  function mock(props: MockComponentProps) {
    return defaultCSSInterop(
      (ComponentType: ComponentType<any>, props: object, key: string) => {
        return <ComponentType {...props} key={key} />;
      },
      component,
      props,
      "key"
    );
  }

  return Object.assign(mock, { component });
}
