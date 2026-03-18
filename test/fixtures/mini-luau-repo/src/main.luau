local Util = require("./util")
require("./bootstrap")

type Request = {
  name: string,
}

function formatName(request: Request)
  return Util.slugify(request.name)
end

local function render()
  return formatName({ name = "Example" })
end

formatAlias = function(request: Request)
  return formatName(request)
end

return {
  formatName = formatName,
  render = render,
  formatAlias = formatAlias,
}
