type User = {
  name: string,
}

local Formatter = {}

function Formatter.format(user: User)
  return user.name
end

local function render(user: User)
  return Formatter.format(user)
end

formatAlias = function(user: User)
  return Formatter.format(user)
end

return {
  format = Formatter.format,
  render = render,
  formatAlias = formatAlias,
}
