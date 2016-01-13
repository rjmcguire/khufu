import * as babel from 'babel-core'
import * as T from "babel-types"
import {compile_body, join_key} from "./compile_view.js"
import * as expression from "./compile_expression.js"
import {push_to_body} from "./babel-util"

function sort_attributes(attributes) {
    let stat = []
    let dyn = []
    for(let [name, value] of attributes) {
        let is_static = false;
        /// TODO(tailhook) maybe employ more deep analysis?
        switch(value && value[0]) {
            case undefined:
            case 'string':
            case 'number':
                is_static = true;
                break;
            default:
                break;
        }
        (is_static ? stat : dyn).push([name, value])
    }
    return [stat, dyn]
}

function insert_static(elname, attributes, path, opt) {
    let topscope = path.scope;
    while(topscope.parent) {
        topscope = topscope.parent;
    }
    let array = [];
    for(var [aname, value] of attributes) {
        array.push(T.stringLiteral(aname))
        if(value == undefined) {
            array.push(T.stringLiteral(aname))
        } else {
            array.push(expression.compile(value, path, opt))
        }
    }
    let ident = topscope.generateUidIdentifier(
        elname.toUpperCase() + '_ATTRS');
    topscope.push({
        id: ident,
        init: T.arrayExpression(array),
        kind: 'let' })
    return ident;
}

function insert_stores(elname, stores, genattrs, path, opt) {
    let stores_id = path.scope.generateUidIdentifier(elname + '_stores');
    path.scope.push({
        id: stores_id,
        init: T.objectExpression([]),
        kind: 'let' })
    genattrs.push(['__stores', T.objectExpression(
        stores.map(([_store, name, value]) => T.objectProperty(
            T.identifier(name),
            expression.compile(value, path, opt))
        ).concat([T.objectProperty(
            T.identifier('__target'), stores_id)]))])
    return stores_id;
}

function insert_links(links, genattrs, path, opt) {
    for(let [_link, names, action, target] of links) {
        let fid = path.scope.generateUidIdentifier('ln_' + names.join('_'))
        let fun = T.functionDeclaration(fid, [T.identifier('event')],
            T.blockStatement([]))
        let fpath = push_to_body(path, fun).get('body');
        console.assert(target[0] == 'store');
        let store = path.scope.getData('khufu:store:raw:' + target[1]);
        if(!store) {
            throw Error("Unknown store: " + target[1]);
        }
        push_to_body(fpath, T.callExpression(
            T.memberExpression(store, T.identifier('dispatch')),
                [expression.compile(action, fpath, opt)]));

        for(let name of names) {
            // TODO(tailhook) support multiple links
            genattrs.push(['on' + name, fid]);
        }
    }
}

export function compile(element, path, opt, key) {
    let [_element, name, classes, attributes, children] = element;

    let links = children.filter(([x]) => x == 'link')
    let stores = children.filter(([x]) => x == 'store')
    let body = children.filter(([x]) => x != 'link' && x != 'store');

    let attrib_expr;
    if(classes.length) {
        for(let [cls, cond] of classes) {
            if(cond) {
                attributes.push(['class',
                    ['if', cond, ['string', cls], ['string', '']]]);
            } else {
                attributes.push(['class', ['string', cls]]);
            }
        }
    }
    if(opt.static_attrs) {
        let [stat, dyn, cls] = sort_attributes(attributes)

        if(stat.length) {
            attrib_expr = insert_static(name, stat, path, opt)
        }
        attributes = dyn
    }
    let genattrs = [];
    let stores_id = null;
    if(stores.length) {
        stores_id = insert_stores(name, stores, genattrs, path, opt)
    }
    if(links.length) {
        insert_links(links, genattrs, path, opt)
    }

    let attribs = [
        T.stringLiteral(name),
        // We need to add a tag name to the element, because incremental-dom
        // throws an exception when tag name is changed. Changing tag
        // name is is only possible with hot-reload, though.
        //
        // TODO(tailhook) should we do it only if hot-reload is enabled?
        join_key(T.stringLiteral(name), key),
    ];
    if(attributes.length || genattrs.length) {
        attribs.push(attrib_expr || T.nullLiteral())
        for(var [aname, value] of attributes) {
            attribs.push(T.stringLiteral(aname))
            if(value) {
                attribs.push(expression.compile(value, path, opt))
            } else {
                attribs.push(T.stringLiteral(aname))
            }
        }
        for(var [aname, value] of genattrs) {
            attribs.push(T.stringLiteral(aname))
            attribs.push(value)
        }
    } else if(attrib_expr) {
        attribs.push(attrib_expr)
    }
    if(body.length == 0) {
        let node = T.callExpression(T.identifier('elementVoid'), attribs)
        path.node.body.push(T.expressionStatement(node))
    } else {
        path.node.body.push(T.expressionStatement(
            T.callExpression(T.identifier('elementOpen'), attribs)))

        let blockpath = push_to_body(path, T.blockStatement([]));
        if(stores_id) {
            for(let [_store, name, _] of stores) {
                blockpath.scope.setData('khufu:store:raw:' + name,
                    T.memberExpression(stores_id, T.identifier(name)));
                blockpath.scope.setData('khufu:store:state:' + name, null);
            }
        }
        compile_body(body, blockpath, opt)
        /// Optimize the scope without variables
        if(Object.keys(blockpath.scope.bindings).length == 0) {
            blockpath.replaceWithMultiple(
                blockpath.get('body').map(x => x.node))
        }

        path.node.body.push(T.expressionStatement(
            T.callExpression(T.identifier('elementClose'),
                [T.stringLiteral(name)])))
    }
}
