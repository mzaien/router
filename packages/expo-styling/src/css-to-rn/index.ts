import {
  KeyframesRule,
  Animation,
  Declaration,
  transform as lightningcss,
  DeclarationBlock,
  MediaQuery,
  MediaRule,
  SelectorList,
  Rule,
} from "lightningcss";

import { parseDeclaration } from "./parseDeclaration";
import { exhaustiveCheck } from "./utils";
import { isRuntimeValue } from "../runtime/native/guards";
import {
  ExtractedKeyframe,
  ExtractedStyle,
  PseudoClassesQuery,
  StyleSheetRegisterOptions,
} from "../types";

interface GetVisitorOptions {
  declarations: Map<string, ExtractedStyle | ExtractedStyle[]>;
  keyframes: Map<string, ExtractedKeyframe[]>;
}

/**
 * LightningCSS visitor that converts CSS to React Native styles
 */
export function cssToReactNativeRuntime(
  code: Buffer
): StyleSheetRegisterOptions {
  const declarations = new Map<string, ExtractedStyle | ExtractedStyle[]>();
  const keyframes = new Map<string, ExtractedKeyframe[]>();

  lightningcss({
    filename: "style.css", // This is ignored, but required
    code,
    visitor: {
      Rule(rule) {
        extractRule(rule, { declarations, keyframes });
        // We have processed this rule, so now delete it from the AST
        return [];
      },
    },
  });

  return {
    declarations: Object.fromEntries(declarations),
    keyframes: Object.fromEntries(keyframes),
  };
}

function extractRule(
  rule: Rule,
  { declarations, keyframes }: GetVisitorOptions
) {
  switch (rule.type) {
    case "keyframes": {
      extractKeyFrames(rule.value, keyframes);
      break;
    }
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

function extractKeyFrames(
  keyframes: KeyframesRule<Declaration>,
  map: Map<string, ExtractedKeyframe[]>
) {
  let frames: ExtractedKeyframe[] = [];

  for (const frame of keyframes.keyframes) {
    const { style } = getExtractedStyle(frame.declarations);

    for (const selector of frame.selectors) {
      const keyframe =
        selector.type === "percentage"
          ? selector.value * 100
          : selector.type === "from"
          ? 0
          : selector.type === "to"
          ? 100
          : undefined;

      if (keyframe === undefined) continue;

      for (const selector of frame.selectors) {
        switch (selector.type) {
          case "percentage":
            frames.push({ selector: selector.value, style });
            break;
          case "from":
            frames.push({ selector: 0, style });
            break;
          case "to":
            frames.push({ selector: 100, style });
            break;
          default:
            exhaustiveCheck(selector);
        }
      }
    }
  }
  frames = frames.sort((a, b) => a.selector - b.selector);

  map.set(keyframes.name.value, frames);
}

function getExtractedStyle(
  declarationBlock: DeclarationBlock<Declaration>
): ExtractedStyle {
  const extrtactedStyle: ExtractedStyle = {
    style: {},
    runtimeStyleProps: [],
    variableProps: [],
  };

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
      extrtactedStyle.variableProps.push(property);
    } else {
      // RN styles need to be camelCase
      property = property.replace(/-./g, (x) => x[1].toUpperCase());
    }

    const style = extrtactedStyle.style;

    if (append) {
      const styleValue = style[property];
      if (Array.isArray(styleValue)) {
        styleValue.push(...value);
      } else {
        style[property] = [value];
      }
    } else if (nullishCoalescing) {
      style[property] ??= value;
    } else {
      style[property] = value;
    }

    if (isRuntimeValue(value)) {
      extrtactedStyle.runtimeStyleProps.push(property);
    }
  }

  function addAnimationProp(property: string, value: any) {
    if (property === "animation") {
      const groupedProperties: Record<string, any[]> = {};

      for (const animation of value as Animation[]) {
        for (const [key, value] of Object.entries(animation)) {
          groupedProperties[key] ??= [];
          groupedProperties[key].push(value);
        }
      }

      extrtactedStyle.animations ??= {};
      for (const [property, value] of Object.entries(groupedProperties)) {
        const key = property
          .replace("animation-", "")
          .replace(/-./g, (x) => x[1].toUpperCase()) as keyof Animation;

        extrtactedStyle.animations[key] ??= value;
      }
    } else {
      const key = property
        .replace("animation-", "")
        .replace(/-./g, (x) => x[1].toUpperCase()) as keyof Animation;

      extrtactedStyle.animations ??= {};
      extrtactedStyle.animations[key] = value;
    }
  }

  for (const declaration of declarationArray) {
    parseDeclaration(declaration, {
      addStyleProp,
      addAnimationProp,
    });
  }

  return extrtactedStyle;
}
