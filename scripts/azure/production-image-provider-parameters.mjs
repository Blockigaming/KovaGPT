function stringParameter(parameters, name, fallback) {
  if (!Object.hasOwn(parameters, name)) return fallback;
  const entry = parameters[name];
  if (!entry || typeof entry !== "object" || typeof entry.value !== "string") {
    throw new Error(`The protected ${name} parameter must have a string value`);
  }
  return entry.value;
}

// Validate references and the template's credential-selection branch only.
// Resource existence and managed-identity vault access require separate evidence.
// Never retrieve a credential or contact an account, vault, or provider here.
export function validateProductionImageProviderParameters({ parameters }) {
  const accountName = stringParameter(parameters, "azureOpenAiImageAccountName", "");
  const secretUri = stringParameter(parameters, "azureOpenAiImageApiKeySecretUri", "");
  if (accountName !== accountName.trim()) {
    throw new Error(
      "The protected azureOpenAiImageAccountName must not contain surrounding whitespace",
    );
  }
  if (secretUri !== "") {
    if (
      !/^https:\/\/[a-zA-Z0-9-]{3,24}\.vault\.azure\.net\/secrets\/[a-zA-Z0-9-]{1,127}\/[a-fA-F0-9]{32}$/u.test(
        secretUri,
      )
    ) {
      throw new Error(
        "The protected azureOpenAiImageApiKeySecretUri must be a versioned Key Vault secret URI",
      );
    }
    if (accountName === "") {
      throw new Error(
        "The protected azureOpenAiImageApiKeySecretUri requires azureOpenAiImageAccountName",
      );
    }
  }
  return {
    azureOpenAiImageAccountName: { value: accountName },
    azureOpenAiImageApiKeySecretUri: { value: secretUri },
  };
}
