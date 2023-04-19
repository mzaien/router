import {
  Declaration,
  transform as lightningcss,
  DeclarationBlock,
  MediaQuery,
  MediaRule,
  SelectorList,
  Rule,
} from "lightningcss";

import { parseDeclaration } from "./parseDeclaration";
import { isRuntimeValue } from "../runtime/native/guards";
import {
  ExtractedStyle,
  PseudoClassesQuery,
  StyleSheetRegisterOptions,
} from "../types";

interface GetVisitorOptions {
  declarations: Map<string, ExtractedStyle | ExtractedStyle[]>;
}

/**
 * LightningCSS visitor that converts CSS to React Native styles
 */
export function cssToReactNativeRuntime(
  code: Buffer
): StyleSheetRegisterOptions {
  const declarations = new Map<string, ExtractedStyle | ExtractedStyle[]>();

  lightningcss({
    filename: "style.css", // This is ignored, but required
    code,
    visitor: {
      Rule(rule) {
        extractRule(rule, { declarations });
        // We have processed this rule, so now delete it from the AST
        return [];
      },
    },
  });

  return {
    declarations: Object.fromEntries(declarations),
  };
}

function extractRule(rule: Rule, { declarations }: GetVisitorOptions) {
  switch (rule.type) {
    case "media": {
      extractedMedia(rule.value, declarations);
      break;
    }
    case "style": {
      if (rule.value.declarations) {
        setStyleForSelectorList(
          getExtractedStyle(rule.value.declarations),
          rule.value.selectors,
          declarations
        );
      }
      break;
    }
  }
}

function setStyleForSelectorList(
  style: ExtractedStyle,
  selectorList: SelectorList,
  declarations: GetVisitorOptions["declarations"]
) {
  for (const selectors of selectorList) {
    let className: string | undefined;
    let pseudoClasses: PseudoClassesQuery | undefined;

    for (const selector of selectors) {
      switch (selector.type) {
        case "combinator":
        case "universal":
        case "namespace":
        case "type":
        case "id":
          break;
        case "class":
          className = selector.name;
          break;
        case "attribute":
          break;
        case "pseudo-class":
          switch (selector.kind) {
            case "not":
            case "first-child":
            case "last-child":
            case "only-child":
            case "root":
            case "empty":
            case "scope":
            case "nth-child":
            case "nth-last-child":
            case "nth-col":
            case "nth-last-col":
            case "nth-of-type":
            case "nth-last-of-type":
            case "first-of-type":
            case "last-of-type":
            case "only-of-type":
            case "host":
            case "where":
            case "is":
            case "any":
            case "has":
            case "lang":
            case "dir":
              break;
            case "hover":
            case "active":
            case "focus":
              pseudoClasses ??= {};
              pseudoClasses[selector.kind] = true;
              break;
            case "focus-visible":
            case "focus-within":
            case "current":
            case "past":
            case "future":
            case "playing":
            case "paused":
            case "seeking":
            case "buffering":
            case "stalled":
            case "muted":
            case "volume-locked":
            case "fullscreen":
            case "defined":
            case "any-link":
            case "link":
            case "local-link":
            case "target":
            case "target-within":
            case "visited":
            case "enabled":
            case "disabled":
            case "read-only":
            case "read-write":
            case "placeholder-shown":
            case "default":
            case "checked":
            case "indeterminate":
            case "blank":
            case "valid":
            case "invalid":
            case "in-range":
            case "out-of-range":
            case "required":
            case "optional":
            case "user-valid":
            case "user-invalid":
            case "autofill":
            case "local":
            case "global":
            case "webkit-scrollbar":
            case "custom":
            case "custom-function":
              break;
          }
          break;
        case "pseudo-element":
        case "nesting":
      }
    }

    if (!className) {
      continue;
    }

    const styleWithPseudoClass = pseudoClasses
      ? { ...style, pseudoClasses }
      : style;

    const existing = declarations.get(className);

    if (Array.isArray(existing)) {
      existing.push(styleWithPseudoClass);
    } else if (existing) {
      declarations.set(className, [existing, styleWithPseudoClass]);
    } else {
      declarations.set(className, styleWithPseudoClass);
    }
  }
}

function extractedMedia(
  mediaRule: MediaRule,
  declarations: GetVisitorOptions["declarations"]
) {
  const media: MediaQuery[] = [];

  for (const mediaQuery of mediaRule.query.mediaQueries) {
    let isScreen = mediaQuery.mediaType !== "print";
    if (mediaQuery.qualifier === "not") {
      isScreen = !isScreen;
    }

    if (isScreen) {
      media.push(mediaQuery);
    }
  }

  if (media.length === 0) {
    return;
  }

  for (const rule of mediaRule.rules) {
    if (rule.type === "style" && rule.value.declarations) {
      const extractedStyle = getExtractedStyle(rule.value.declarations);

      setStyleForSelectorList(
        { ...extractedStyle, media },
        rule.value.selectors,
        declarations
      );
    }
  }

  return undefined;
}

function getExtractedStyle(
  declarationBlock: DeclarationBlock<Declaration>
): ExtractedStyle {
  const style: Record<string, any> = {};
  const runtimeStyleProps: string[] = [];
  const variableProps: string[] = [];

  const declarationArray = [
    declarationBlock.declarations,
    declarationBlock.importantDeclarations,
  ]
    .flat()
    .filter((d): d is Declaration => !!d);

  /*
   * Adds a style property to the rule record. Use nullish coalescing to control setting shorthand vs longhand
   *
   * For example, margin-right should use `nullishCoalescing=false`, but margin should use `true`
   * This is because margin-right is a longhand property of margin, so it should override the shorthand
   *
   * @param property - the property name
   * @param value - the property value
   * @param nullishCoalescing - whether to use nullish coalescing to set the property
   */
  function addStyleProp(
    property: string,
    value: any,
    { nullishCoalescing = false, append = false } = {}
  ) {
    if (value === undefined) {
      return;
    }

    if (property.startsWith("--")) {
      variableProps.push(property);
    } else {
      // RN styles need to be camelCase
      property = property.replace(/-./g, (x) => x[1].toUpperCase());
    }

    if (append) {
      if (Array.isArray(style[property])) {
        style[property].push(...value);
      } else {
        style[property] = [value];
      }
    } else if (nullishCoalescing) {
      style[property] ??= value;
    } else {
      style[property] = value;
    }

    if (isRuntimeValue(value)) {
      runtimeStyleProps.push(property);
    }
  }

  for (const declaration of declarationArray) {
    parseDeclaration(declaration, addStyleProp);
  }

  return {
    runtimeStyleProps,
    variableProps,
    style,
  };
}
