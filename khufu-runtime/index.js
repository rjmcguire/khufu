import {store_handler} from './stores'
import {patch, attributes} from 'incremental-dom'

export {REMOVED} from './stores'

function set_global_state(fun) {
    attributes.__stores = store_handler(fun)
}

function clean_global_state(old) {
}

export default function init(element, template) {
    function render(new_tpl) {
        let obj = set_global_state(render)
        try {
            patch(element, template)
        } catch(e) {
            console.error("Render error", e)
        }
        clean_global_state(obj)
    }
    render()
    return render
}