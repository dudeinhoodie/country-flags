import { TypedInMemoryProvider } from "@openfeature/server-sdk";

import { FEATURE_FLAGS } from "./feature-flag.registry";

/** The production-safe provider until a control plane is explicitly selected. */
export class LocalStaticFeatureProvider extends TypedInMemoryProvider {
  constructor() {
    super();
    this.putConfiguration(
      Object.fromEntries(
        [...FEATURE_FLAGS.values()].map((definition) => [
          definition.key,
          {
            variants: { default: definition.defaultValue },
            defaultVariant: "default",
            disabled: false,
          },
        ]),
      ),
    );
  }
}
