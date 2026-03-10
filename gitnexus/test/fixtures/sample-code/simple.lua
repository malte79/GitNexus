local Util = {}

function Util.slugify(value)
  return string.lower(value)
end

local function internal_helper()
  return Util.slugify("Hello")
end

return {
  slugify = Util.slugify,
  internal_helper = internal_helper,
}
