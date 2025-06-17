class MetaAIException extends Error {
  constructor(message) {
    super(message);
    this.name = "MetaAIException";
  }
}

class FacebookRegionBlocked extends MetaAIException {
  constructor(message) {
    super(message);
    this.name = "FacebookRegionBlocked";
  }
}

class FacebookInvalidCredentialsException extends MetaAIException {
  constructor(message) {
    super(message);
    this.name = "FacebookInvalidCredentialsException";
  }
}

module.exports = {
  MetaAIException,
  FacebookRegionBlocked,
  FacebookInvalidCredentialsException
}; 