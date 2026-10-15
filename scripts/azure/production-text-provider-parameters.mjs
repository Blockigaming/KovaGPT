function stringParameter(parameters, name, fallback) {
  if (!Object.hasOwn(parameters, name)) return fallback;
  const entry = parameters[name];
  if (!entry || typeof entry !== "object" || typeof entry.value !== "string") {
    throw new Error(`The protected ${name} parameter must have a string value`);
  }
  return entry.value;
}

// Validate references only. Never retrieve credentials or contact a provider.
export function validateProductionTextProviderParameters({ parameters }) {
  const textProvider = stringParameter(parameters, "textProvider", "auto");
  if (!["auto", "openai", "azure_openai"].includes(textProvider)) {
    throw new Error("The production text provider must be auto, openai or azure_openai");
  }
  const secretUri = stringParameter(parameters, "openAiApiKeySecretUri", "");
  if (secretUri !== "") {
    const vaultName = stringParameter(parameters, "keyVaultName", "");
    const parsed =
      /^https:\/\/([a-zA-Z0-9-]{3,24})\.vault\.azure\.net\/secrets\/[a-zA-Z0-9-]{1,127}\/([a-fA-F0-9]{32})$/u.exec(
        secretUri,
      );
    if (!parsed || parsed[1].toLowerCase() !== vaultName.toLowerCase()) {
      throw new Error(
        "The protected openAiApiKeySecretUri must be a versioned secret URI in the selected vault",
      );
    }
  }
  if (textProvider === "openai" && secretUri === "") {
    throw new Error("Direct OpenAI text requires the existing OpenAI API key secret reference");
  }
  return {
    textProvider: { value: textProvider },
    openAiApiKeySecretUri: { value: secretUri },
  };
}
