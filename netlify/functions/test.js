exports.handler = async () => {
  const key = process.env.GROK_API_KEY;
  return {
    statusCode: 200,
    body: JSON.stringify({
      hasKey: !!key,
      keyStart: key ? key.substring(0, 10) : 'none'
    })
  };
};
